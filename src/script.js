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

// MOVIMIENTO y ANIMACIONES
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

// Raycaster para suelo
const downRay = new THREE.Raycaster()
downRay.far = 40

// Mesh lists: groundMeshes para raycast Y, obstacleMeshes para colisiones laterales
let groundMeshes = []
let obstacleMeshes = []

// ================================
// GLTF Loader (DRACO)
// ================================
const gltfLoader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')
gltfLoader.setDRACOLoader(dracoLoader)

// ================================
// SISTEMA DE ESCENARIOS
// ================================
let currentSceneIndex = 0
let loadedScene = null

// nombres de archivos que dijiste
const scenesList = [
    { name: "muelle", file: "./models/muelle/sample.gltf" },
    { name: "arbol",  file: "./models/casaarbol/casarbol.gltf" }
]

// limpia meshes y escena
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

// Clasificación mejorada para evitar que ramas/raíces sean 'ground'
function classifyMeshAsGroundOrObstacle(obj) {
    if (!obj.isMesh || !obj.visible) return null

    const name = (obj.name || "").toLowerCase()

    // EXCLUSIONES por nombre (útiles para casarbol)
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
        name.includes("branch") ||
        name.includes("deco") ||
        name.includes("leaf") ||
        name.includes("hoja")
    ) {
        return "obstacle"
    }

    // Agua, fondos o meshes inútiles
    if (name.includes("water") || name.includes("mar") || name.includes("ocean")) return null

    // Bounding box world-aligned
    const box = new THREE.Box3().setFromObject(obj)
    const size = new THREE.Vector3()
    box.getSize(size)

    const height = size.y
    const area = size.x * size.z
    const thickness = Math.min(size.x, size.z)

    // Heurística refinada:
    // - plano grande y bajo => ground
    // - objetos altos => obstacle
    // - delgados/largos => obstacle (barandas/troncos)
    if (height < 0.12 && area > 0.6) return "ground"
    if (height >= 0.25) return "obstacle"
    if (thickness < 0.05 && area > 0.12) return "obstacle"
    if (area > 1.0 && height < 0.2) return "ground"

    // fallback: preferir ground para permitir caminar
    if (area > 0.03) return "ground"
    return null
}

function loadScene(index) {
    clearCurrentScene()
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

            // reajustar Y del personaje si ya está cargado
            if (model) {
                const gy = getGroundYAtPosition(model.position)
                if (gy !== null) model.position.y = gy + modelGroundOffset
            }

            console.log("Escenario cargado:", info.name, " ground:", groundMeshes.length, " obstacles:", obstacleMeshes.length)
        },
        undefined,
        err => {
            console.error("Error cargando escenario:", err)
        }
    )
}

// cargar escena inicial
loadScene(currentSceneIndex)

// ================================
// Cargar personaje (xiaowalk.gltf)
// ================================
gltfLoader.load(
    './models/xiaowalk.gltf',
    gltf => {
        model = gltf.scene
        model.scale.set(0.30, 0.30, 0.30)
        model.position.set(-3, 0.5, -2)

        model.traverse(child => { if (child.isMesh) child.castShadow = true })
        scene.add(model)

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

// ================================
// funciones de suelo / colisión
// ================================
function getGroundYAtPosition(pos) {
    // ray desde arriba
    const origin = new THREE.Vector3(pos.x, 20, pos.z)
    downRay.set(origin, new THREE.Vector3(0, -1, 0))

    // Usar groundMeshes si hay, si no usar loadedScene para fallback
    const targets = groundMeshes.length > 0 ? groundMeshes : (loadedScene ? [loadedScene] : scene.children)
    const hits = downRay.intersectObjects(targets, true)
    if (hits.length === 0) return null

    // Elegir el HIT más alto (mayor Y) entre los resultados: evita que pequeñas geometrías por debajo nos confundan.
    let best = hits[0]
    for (let h of hits) {
        if (h.point.y > best.point.y) best = h
    }
    return best.point.y
}

function detectHorizontalCollision(newPos) {
    // caja del personaje en la nueva posición
    const boxSize = new THREE.Vector3(0.45, 1.0, 0.45)
    const tempBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(newPos.x, newPos.y + 0.5, newPos.z),
        boxSize
    )

    // comprobar solo contra obstacleMeshes (no contra suelo)
    for (let o of obstacleMeshes) {
        const box = new THREE.Box3().setFromObject(o)
        if (tempBox.intersectsBox(box)) return true
    }
    return false
}

// cámara sigue al personaje
function updateCameraFollow() {
    if (!model) return
    const target = model.position.clone()
    target.y += 1.2
    controls.target.lerp(target, 0.12)
}

// ================================
// loop
// ================================
const clock = new THREE.Clock()
let initialGroundSet = false

function tick() {
    const dt = clock.getDelta()
    if (mixer) mixer.update(dt)

    if (model) {
        if (!initialGroundSet && (groundMeshes.length > 0 || obstacleMeshes.length > 0)) {
            const gy = getGroundYAtPosition(model.position)
            if (gy !== null) {
                model.position.y = gy + modelGroundOffset
                initialGroundSet = true
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
            // movimiento relativo a cámara
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
                    // Intento a lo ancho: permitir pequeño deslizamiento paralelo si bloqueado frontalmente
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

                // rotación hacia movimiento
                const targetRot = new THREE.Quaternion()
                targetRot.setFromUnitVectors(new THREE.Vector3(0, 0, 1), moveDir)
                model.quaternion.slerp(targetRot, rotationSpeed * dt)
            }
        }

        // mantener pies en el suelo
        const gy = getGroundYAtPosition(model.position)
        if (gy !== null) model.position.y = gy + modelGroundOffset

        updateCameraFollow()
    }

    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
}
tick()

// ================================
// FLECHAS ESCENARIOS (HTML debe tener .left-arrow y .right-arrow)
// ================================
const leftEl = document.querySelector('.left-arrow')
const rightEl = document.querySelector('.right-arrow')

if (!leftEl && !rightEl) {
    console.warn("No se encontraron elementos .left-arrow ni .right-arrow en el DOM.")
}
if (leftEl) leftEl.addEventListener('click', () => {
    currentSceneIndex = (currentSceneIndex - 1 + scenesList.length) % scenesList.length
    loadScene(currentSceneIndex)
})
if (rightEl) rightEl.addEventListener('click', () => {
    currentSceneIndex = (currentSceneIndex + 1) % scenesList.length
    loadScene(currentSceneIndex)
})
