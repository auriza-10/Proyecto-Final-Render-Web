import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import GUI from 'lil-gui'

const gui = new GUI()

const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000010)

// luces
const ambientLight = new THREE.AmbientLight(0xffffff, 2.0)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.6)
directionalLight.castShadow = true
directionalLight.shadow.mapSize.set(1024, 1024)
directionalLight.position.set(5, 5, 5)
scene.add(directionalLight)

// fondo estrellado
function createStarField() {
    const starCount = 800
    const geometry = new THREE.BufferGeometry()
    const positions = []
    const colors = []

    for (let i = 0; i < starCount; i++) {
        const x = (Math.random() - 0.5) * 300
        const y = (Math.random() - 0.5) * 200 + 80
        const z = (Math.random() - 0.5) * 300

        positions.push(x, y, z)

        const blue = 0.6 + Math.random() * 0.4
        const c = new THREE.Color(0.2, 0.2, blue)
        colors.push(c.r, c.g, c.b)
    }


    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
        size: 1,
        vertexColors: true,
        transparent: true
    })

    const stars = new THREE.Points(geometry, material)
    scene.add(stars)
}
createStarField()

const sizes = { width: window.innerWidth, height: window.innerHeight }
window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

// cámara
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 200)
camera.position.set(3, 3, 5)
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.49
controls.minDistance = 2
controls.maxDistance = 18

// renderer
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

// Movimiento y animaciones
let model = null
let mixer = null
let walkAction = null
let idleAction = null

const speed = 2.2
const rotationSpeed = 6
const modelGroundOffset = 0.02
const keys = { w: false, a: false, s: false, d: false }
window.addEventListener("keydown", e => { if (e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = true })
window.addEventListener("keyup", e => { if (e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = false })

// Scene loading state
let isSceneLoading = false

// Raycaster para suelo
const downRay = new THREE.Raycaster()
downRay.far = 40

let groundMeshes = []
let obstacleMeshes = []

// GLTF Loader
const gltfLoader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')
gltfLoader.setDRACOLoader(dracoLoader)

// sistema de escenarios
let currentSceneIndex = 0
let loadedScene = null

// 3 escenarios 
const scenesList = [
    { name: "muelle",   file: "./models/muelle/sample.gltf" },
    { name: "arbol",    file: "./models/casaarbol/casarbol.gltf" },
    { name: "castillo", file: "./models/castillo/castillo.gltf" }
]

// meshes y escena
function clearCurrentScene() {
    if (loadedScene) {
        scene.remove(loadedScene)
        loadedScene.traverse(obj => {
            if (obj.isMesh) {
                try { if (obj.geometry) obj.geometry.dispose() } catch (e) {}
                try {
                    if (obj.material) {
                        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose && m.dispose())
                        else obj.material.dispose && obj.material.dispose()
                    }
                } catch (e) {}
            }
        })
        loadedScene = null
    }
    groundMeshes.length = 0
    obstacleMeshes.length = 0
}

function classifyMeshAsGroundOrObstacle(obj) {
    if (!obj.isMesh || !obj.visible) return null

    const name = (obj.name || "").toLowerCase()

    if (
        name.includes("branch") ||
        name.includes("rama") ||
        name.includes("root") ||
        name.includes("raiz") ||
        name.includes("stick") ||
        name.includes("plataforma") ||
        name.includes("platform") ||
        name.includes("wood") ||
        name.includes("tronco") ||
        name.includes("ladder") ||
        name.includes("escalera") ||
        name.includes("rail") ||
        name.includes("baranda") ||
        name.includes("deco") ||
        name.includes("leaf") ||
        name.includes("hoja")
    ) { return "obstacle" }

    if (name.includes("water") || name.includes("mar") || name.includes("ocean")) return null

    const box = new THREE.Box3().setFromObject(obj)
    const size = new THREE.Vector3()
    box.getSize(size)

    const height = size.y
    const area = size.x * size.z
    const thickness = Math.min(size.x, size.z)

    if (height < 0.12 && area > 0.6) return "ground"
    if (height >= 0.25) return "obstacle"
    if (thickness < 0.05 && area > 0.12) return "obstacle"
    if (area > 1.0 && height < 0.2) return "ground"
    if (area > 0.03) return "ground"
    return null
}

function findGroundTopUnderPosition(pos) {
    
    let best = null
    for (let m of groundMeshes) {
        try {
            const b = new THREE.Box3().setFromObject(m)
            const pad = 0.2
            const minX = b.min.x - pad, maxX = b.max.x + pad
            const minZ = b.min.z - pad, maxZ = b.max.z + pad
            if (pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ) {
                const area = (b.max.x - b.min.x) * (b.max.z - b.min.z)
                const topY = b.max.y
                if (!best || area > best.area) best = { area, topY, mesh: m }
            }
        } catch (e) {

        }
    }
    if (!best) return null

    const thresholdAbove = (pos.y || 0) + 1.0
    const belowCandidates = []
    for (let m of groundMeshes) {
        try {
            const b = new THREE.Box3().setFromObject(m)
            const pad = 0.2
            const minX = b.min.x - pad, maxX = b.max.x + pad
            const minZ = b.min.z - pad, maxZ = b.max.z + pad
            if (pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ) {
                const area = (b.max.x - b.min.x) * (b.max.z - b.min.z)
                const topY = b.max.y
                if (topY <= thresholdAbove) belowCandidates.push({ area, topY, mesh: m })
            }
        } catch (e) {}
    }

    if (belowCandidates.length > 0) {
       
        let pick = belowCandidates[0]
        for (let c of belowCandidates) if (c.topY > pick.topY) pick = c
        return pick.topY
    }

   
    return best ? best.topY : null
}


const sceneGroundYOffset = {
    2: -2.0, 
    3: -0.4  
}

function isPositionInsideObstacle(testPos) {
    if (!model) return false
    try {
       
        const modelBox = new THREE.Box3().setFromObject(model)
        const delta = new THREE.Vector3().subVectors(testPos, model.position)
        const testBox = modelBox.clone()
        testBox.min.add(delta)
        testBox.max.add(delta)

        for (let obs of obstacleMeshes) {
            try {
                const obsBox = new THREE.Box3().setFromObject(obs)
                if (testBox.intersectsBox(obsBox)) return true
            } catch (e) {}
        }
    } catch (e) {
    }
    return false
}

function findSafeSpawnPositionOnMesh(largest, sceneIndex) {
    if (!largest || !model) return null
    const bb = largest.bbox
    const centerX = (bb.min.x + bb.max.x) / 2
    const centerZ = (bb.min.z + bb.max.z) / 2

    
    const sceneOffset = sceneGroundYOffset[sceneIndex] || 0
    const pad = 0.1

    const width = Math.max(0.5, bb.max.x - bb.min.x - 2 * pad)
    const depth = Math.max(0.5, bb.max.z - bb.min.z - 2 * pad)
    const grid = 9 
    const stepX = width / Math.max(1, grid - 1)
    const stepZ = depth / Math.max(1, grid - 1)

   
    const candidates = []
    for (let ix = 0; ix < grid; ix++) {
        for (let iz = 0; iz < grid; iz++) {
            const tx = bb.min.x + pad + ix * stepX
            const tz = bb.min.z + pad + iz * stepZ
            const probePos = new THREE.Vector3(tx, 0, tz)

        
            let topY = findGroundTopUnderPosition(probePos)
            if (topY === null) topY = getGroundYAtPosition(probePos)
            if (topY === null) continue

            const candidate = new THREE.Vector3(tx, topY + modelGroundOffset + sceneOffset, tz)

            if (tx < bb.min.x - pad || tx > bb.max.x + pad || tz < bb.min.z - pad || tz > bb.max.z + pad) continue

        
            if (!isPositionInsideObstacle(candidate)) {
                const distFromCenter = Math.sqrt((tx - centerX) ** 2 + (tz - centerZ) ** 2)
                candidates.push({ pos: candidate, dist: distFromCenter })
            }
        }
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => b.dist - a.dist)
        return candidates[0].pos
    }

    return new THREE.Vector3(centerX, largest.topY + modelGroundOffset + sceneOffset, centerZ)
}

function unstickModel(maxAttempts = 20, baseStep = 0.3) {
    if (!model) return false
    if (!isPositionInsideObstacle(model.position)) return false

    
    const dirs = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(1, 0, 1).normalize(),
        new THREE.Vector3(-1, 0, 1).normalize(),
        new THREE.Vector3(1, 0, -1).normalize(),
        new THREE.Vector3(-1, 0, -1).normalize()
    ]

    for (let i = 1; i <= maxAttempts; i++) {
        const dist = baseStep * i
        for (let d of dirs) {
            const cand = model.position.clone().add(d.clone().multiplyScalar(dist))
            const gy = findGroundTopUnderPosition(cand) || getGroundYAtPosition(cand)
            if (gy === null) continue
            cand.y = gy + modelGroundOffset + (sceneGroundYOffset[currentSceneIndex] || 0)
            if (!isPositionInsideObstacle(cand)) {
                model.position.copy(cand)
                console.log('unstickModel: moved model by', d, 'dist', dist, 'to', cand)
                return true
            }
        }
    }
    return false
}

function placeModelOnGroundY(targetY) {
    
    if (!model) return false
    try {
        const bbox = new THREE.Box3().setFromObject(model)
        if (bbox && isFinite(bbox.min.y)) {
            const beforeMin = bbox.min.y
            const beforeMax = bbox.max.y
            const delta = targetY - bbox.min.y
            model.position.y += delta
            try {
                const nb = new THREE.Box3().setFromObject(model)
                console.log('placeModelOnGroundY: adjusted by', delta, 'beforeMin', beforeMin, 'beforeMax', beforeMax, 'afterMin', nb.min.y, 'afterPosY', model.position.y)
            } catch (e) {
                console.log('placeModelOnGroundY: adjusted by', delta, 'new model.position.y', model.position.y)
            }
            return true
        }
    } catch (e) {
        console.warn('placeModelOnGroundY failed:', e)
    }
    model.position.y = targetY
    return false
}

function findLargestGroundMesh() {
    let best = null
    for (let m of groundMeshes) {
        try {
            const b = new THREE.Box3().setFromObject(m)
            const area = (b.max.x - b.min.x) * (b.max.z - b.min.z)
            if (!best || area > best.area) best = { mesh: m, bbox: b, area, topY: b.max.y }
        } catch (e) {
           
        }
    }
    return best
}

function loadScene(index) {
    clearCurrentScene()
    
    // Mark scene as loading - disable arrows
    isSceneLoading = true
    const leftEl = document.querySelector('.left-arrow')
    const rightEl = document.querySelector('.right-arrow')
    if (leftEl) leftEl.style.opacity = '0.2'
    if (rightEl) rightEl.style.opacity = '0.2'
    if (leftEl) leftEl.style.pointerEvents = 'none'
    if (rightEl) rightEl.style.pointerEvents = 'none'

    const info = scenesList[index]

    gltfLoader.load(
        info.file,
        gltf => {
            loadedScene = gltf.scene
            loadedScene.updateWorldMatrix(true, true)

            loadedScene.traverse(obj => {
                if (!obj.isMesh) return
                obj.castShadow = true
                obj.receiveShadow = true

                const cls = classifyMeshAsGroundOrObstacle(obj)
                if (cls === "ground") groundMeshes.push(obj)
                else if (cls === "obstacle") obstacleMeshes.push(obj)
            })

            scene.add(loadedScene)

            
            console.log(
                "Escenario cargado:",
                info.name,
                "groundMeshes:",
                groundMeshes.length,
                "obstacleMeshes:",
                obstacleMeshes.length,
                "modelPos:",
                model ? model.position.clone() : null
            )

            if (model) {
                
                const largest = findLargestGroundMesh()
                const sceneOffset = sceneGroundYOffset[index] || 0
                if (largest) {
                    
                    const safe = findSafeSpawnPositionOnMesh(largest, index)
                    if (safe) {
                        model.position.x = safe.x
                        model.position.z = safe.z
                       
                        model.position.y = safe.y
                        console.log('Moved model to safe spawn:', safe.x, safe.y, safe.z)
                        placeModelOnGroundY(safe.y)
                        console.log('Placed model on largest ground top (safe):', safe.y)
                       
                        if (isPositionInsideObstacle(model.position)) {
                            console.log('Model is still inside obstacle, attempting unstick...')
                            const unst = unstickModel()
                            console.log('unstickModel result:', unst)
                        }
                    } else {
                        const bb = largest.bbox
                        // el centro del ground más grande
                        const insideXZ = model.position.x >= bb.min.x && model.position.x <= bb.max.x && model.position.z >= bb.min.z && model.position.z <= bb.max.z
                        if (!insideXZ) {
                            model.position.x = (bb.min.x + bb.max.x) / 2
                            model.position.z = (bb.min.z + bb.max.z) / 2
                            console.log('Moved model XZ to largest ground center (fallback):', model.position.x, model.position.z)
                        }

                        // lugar el Y
                        const proposed = largest.topY + modelGroundOffset + sceneOffset
                        placeModelOnGroundY(proposed)
                        console.log('Placed model on largest ground top (fallback):', proposed)
                    }
                } else {
                
                    const topY = findGroundTopUnderPosition(model.position)
                    const sceneOffset2 = sceneGroundYOffset[index] || 0
                    if (topY !== null && Number.isFinite(topY)) {
                        const proposed = topY + modelGroundOffset + sceneOffset2
                        placeModelOnGroundY(proposed)
                        console.log('Placed model on ground top under position:', proposed)
                    } else {
                        const gy = getGroundYAtPosition(model.position)
                        if (gy !== null) placeModelOnGroundY(gy + modelGroundOffset + sceneOffset2)
                    }
                }
            }

            console.log("Escenario cargado:", info.name)
            
    
            if (model) {
                try {
                    const camTarget = model.position.clone()
                    controls.target.copy(camTarget)
                    camera.position.copy(camTarget.clone().add(new THREE.Vector3(0, 2.5, 5)))
                    controls.update()
                } catch (e) {
                    console.warn('Failed to recenter camera:', e)
                }
            }
            
            isSceneLoading = false
            const leftEl = document.querySelector('.left-arrow')
            const rightEl = document.querySelector('.right-arrow')
            if (leftEl) leftEl.style.opacity = '0.5'
            if (rightEl) rightEl.style.opacity = '0.5'
            if (leftEl) leftEl.style.pointerEvents = 'auto'
            if (rightEl) rightEl.style.pointerEvents = 'auto'
        },
        undefined,
        err => {
            console.error("Error cargando escenario:", err)
            isSceneLoading = false
            const leftEl = document.querySelector('.left-arrow')
            const rightEl = document.querySelector('.right-arrow')
            if (leftEl) leftEl.style.opacity = '0.5'
            if (rightEl) rightEl.style.opacity = '0.5'
            if (leftEl) leftEl.style.pointerEvents = 'auto'
            if (rightEl) rightEl.style.pointerEvents = 'auto'
        }
    )
}

loadScene(currentSceneIndex)


gltfLoader.load(
    './models/xiaowalk.gltf',
    gltf => {
        model = gltf.scene
        model.scale.set(0.30, 0.30, 0.30)
        model.position.set(-3, 0.5, -2)

        model.traverse(child => { if (child.isMesh) child.castShadow = true })
        scene.add(model)

        
        model.visible = true
        model.traverse(c => { if (c.isMesh) c.visible = true })

       
        try {
            const camTarget = model.position.clone()
            controls.target.copy(camTarget)
            camera.position.copy(camTarget.clone().add(new THREE.Vector3(0, 2.5, 5)))
            controls.update()
        } catch (e) {}

        mixer = new THREE.AnimationMixer(model)
        walkAction = mixer.clipAction(gltf.animations[0])

        let idleClip
        try { idleClip = THREE.AnimationUtils.subclip(gltf.animations[0], 'idle', 0, 1) }
        catch { idleClip = gltf.animations[0] }
        idleAction = mixer.clipAction(idleClip)

        idleAction.play()

        
    },
    undefined,
    err => console.error('Error cargando modelo:', err)
)

function getGroundYAtPosition(pos) {
    const origin = new THREE.Vector3(pos.x, 20, pos.z)
    downRay.set(origin, new THREE.Vector3(0, -1, 0))

    const targets = groundMeshes.length > 0 ? groundMeshes : (loadedScene ? [loadedScene] : scene.children)
    const hits = downRay.intersectObjects(targets, true)
    if (hits.length === 0) return null

    let best = hits[0]
    for (let h of hits) {
        if (h.point.y > best.point.y) best = h
    }
    return best.point.y
}

function detectHorizontalCollision(newPos) {
    
    if (!model) return false

    const origin = model.position.clone()
    origin.y += 0.5 

    const dir = new THREE.Vector3(newPos.x - model.position.x, 0, newPos.z - model.position.z)
    if (dir.length() === 0) return false
    dir.normalize()

    const maxDist = 0.6
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist)

    const targets = loadedScene ? [loadedScene] : scene.children
    const hits = ray.intersectObjects(targets, true)

    for (let h of hits) {
        if (!h.object) continue
        if (h.object === model) continue

        try {
            const b = new THREE.Box3().setFromObject(h.object)
            const s = new THREE.Vector3()
            b.getSize(s)
            const area = s.x * s.z
            if (area < 0.02) continue
        } catch (e) {

        }

        return true
    }

    return false
}

function updateCameraFollow() {
    if (!model) return
    const target = model.position.clone()
    target.y += 1.2
    controls.target.lerp(target, 0.12)
}

// loop
const clock = new THREE.Clock()
let initialGroundSet = false

function tick() {
    const dt = clock.getDelta()
    if (mixer) mixer.update(dt)

    if (model) {
        if (!initialGroundSet && (groundMeshes.length > 0 || obstacleMeshes.length > 0)) {
            
            const sceneOffsetInit = sceneGroundYOffset[currentSceneIndex] || 0
            const topY = findGroundTopUnderPosition(model.position)
            if (topY !== null && Number.isFinite(topY)) {
                placeModelOnGroundY(topY + modelGroundOffset + sceneOffsetInit)
                initialGroundSet = true
            } else {
                const gy = getGroundYAtPosition(model.position)
                if (gy !== null) {
                    placeModelOnGroundY(gy + modelGroundOffset + sceneOffsetInit)
                    initialGroundSet = true
                }
            }
        }

        const input = new THREE.Vector3()
        if (keys.w) input.z -= 1
        if (keys.s) input.z += 1
        if (keys.a) input.x -= 1
        if (keys.d) input.x += 1

        const isMoving = input.length() > 0

        if (isMoving) {
            if (idleAction) idleAction.stop()
            if (walkAction) walkAction.play()
        } else {
            if (walkAction) walkAction.stop()
            if (idleAction) idleAction.play()
        }

        if (isMoving) {
            const camDir = new THREE.Vector3()
            camera.getWorldDirection(camDir)
            camDir.y = 0
            camDir.normalize()

            const camRight = new THREE.Vector3()
            camRight.crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize()

            const moveDir = new THREE.Vector3()
            moveDir.addScaledVector(camDir, input.z)
            moveDir.addScaledVector(camRight, input.x)
            moveDir.normalize()

            const step = moveDir.clone().multiplyScalar(speed * dt)
            const nextPos = model.position.clone().add(step)

            const nextY = getGroundYAtPosition(nextPos)
            if (nextY !== null) {
                const next = nextPos.clone()
                next.y = nextY + modelGroundOffset

                if (!detectHorizontalCollision(next)) {
                    model.position.copy(next)
                } else {
                    const tryX = model.position.clone().add(new THREE.Vector3(step.x, 0, 0))
                    const tryXZ = tryX.clone()
                    const ty1 = getGroundYAtPosition(tryX)
                    if (ty1 !== null) tryXZ.y = ty1 + modelGroundOffset
                    if (!detectHorizontalCollision(tryXZ)) model.position.copy(tryXZ)
                    else {
                        const tryZ = model.position.clone().add(new THREE.Vector3(0, 0, step.z))
                        const tryZZ = tryZ.clone()
                        const ty2 = getGroundYAtPosition(tryZ)
                        if (ty2 !== null) tryZZ.y = ty2 + modelGroundOffset
                        if (!detectHorizontalCollision(tryZZ)) model.position.copy(tryZZ)
                    }
                }

                const targetRot = new THREE.Quaternion()
                targetRot.setFromUnitVectors(new THREE.Vector3(0, 0, 1), moveDir)
                model.quaternion.slerp(targetRot, rotationSpeed * dt)
            }
        }

        
        const sceneOffsetLive = sceneGroundYOffset[currentSceneIndex] || 0
        const topY2 = findGroundTopUnderPosition(model.position)
        if (topY2 !== null && Number.isFinite(topY2)) {
            placeModelOnGroundY(topY2 + modelGroundOffset + sceneOffsetLive)
        } else {
            const gy2 = getGroundYAtPosition(model.position)
            if (gy2 !== null) placeModelOnGroundY(gy2 + modelGroundOffset + sceneOffsetLive)
        }

        updateCameraFollow()

        
    }

    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
}
tick()

// flechas para el cambio de escenarios
const leftEl = document.querySelector('.left-arrow')
const rightEl = document.querySelector('.right-arrow')

if (!leftEl && !rightEl) {
    console.warn("No se encontraron elementos .left-arrow ni .right-arrow en el DOM.")
}
if (leftEl) leftEl.addEventListener('click', () => {
    if (isSceneLoading) {
        console.log('Scene is still loading, please wait...')
        return
    }
    currentSceneIndex = (currentSceneIndex - 1 + scenesList.length) % scenesList.length
    loadScene(currentSceneIndex)
})
if (rightEl) rightEl.addEventListener('click', () => {
    if (isSceneLoading) {
        console.log('Scene is still loading, please wait...')
        return
    }
    currentSceneIndex = (currentSceneIndex + 1) % scenesList.length
    loadScene(currentSceneIndex)
})


const instructionsModal = document.getElementById('instructionsModal')
const closeInstructionsBtn = document.getElementById('closeInstructions')

if (closeInstructionsBtn) {
    closeInstructionsBtn.addEventListener('click', () => {
        instructionsModal.classList.add('hidden')
    })
}


if (instructionsModal) {
    instructionsModal.addEventListener('click', (e) => {
        if (e.target === instructionsModal) {
            instructionsModal.classList.add('hidden')
        }
    })
}
