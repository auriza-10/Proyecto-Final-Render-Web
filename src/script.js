import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import GUI from 'lil-gui'

const gui = new GUI()

const canvas = document.querySelector('canvas.webgl')

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000010);

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
    const starCount = 800;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];

    for (let i = 0; i < starCount; i++) {
        const x = (Math.random() - 0.5) * 300;
        const y = (Math.random() - 0.5) * 200 + 80;
        const z = (Math.random() - 0.5) * 300;

        positions.push(x, y, z);

        const blue = 0.6 + Math.random() * 0.4;
        const c = new THREE.Color(0.2, 0.2, blue);
        colors.push(c.r, c.g, c.b);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 1,
        vertexColors: true,
        transparent: true
    });

    const stars = new THREE.Points(geometry, material);
    scene.add(stars);
}
createStarField();


const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () =>
{
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
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true
})
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

// varibles globales
let model = null
let mixer = null
let walkAction = null
let idleAction = null

const speed = 2.2
const rotationSpeed = 6
const modelGroundOffset = 0.02
const keys = { w: false, a: false, s: false, d: false }

window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = true;
})
window.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() in keys) keys[e.key.toLowerCase()] = false;
})

// Raycaster para detectar el muelle
const downRay = new THREE.Raycaster()
downRay.far = 20

// Objetos sólidos del muelle
const colliders = []

// cargar modelos
const gltfLoader = new GLTFLoader()

// Configuración de draco
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')
gltfLoader.setDRACOLoader(dracoLoader)

// escenario 1
gltfLoader.load(
    './models/muelle/sample.gltf',
    function(gltf) {
        const muelle = gltf.scene
        muelle.traverse(obj => {
            if (obj.isMesh) {
                obj.castShadow = true
                obj.receiveShadow = true

                const name = (obj.name || "").toLowerCase()
                const isWater = name.includes("water") || name.includes("mar") || name.includes("ocean")

                
                if (!isWater) colliders.push(obj)
            }
        })
        scene.add(muelle)
    },
    undefined,
    function(err) { console.error('Error cargando muelle:', err) }
)

// Personaje xiao
gltfLoader.load(
    './models/xiaowalk.gltf',
    function(gltf) {

        model = gltf.scene
        model.scale.set(0.30, 0.30, 0.30)
        model.position.set(-3, 0.5, -2)

        model.traverse(child => {
            if (child.isMesh) child.castShadow = true
        })
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
    function(err) { console.error('Error cargando modelo:', err) }
)

// altura del muelle
function getGroundYAtPosition(pos) {
    const origin = new THREE.Vector3(pos.x, 10, pos.z)
    downRay.set(origin, new THREE.Vector3(0, -1, 0))

    const hits = downRay.intersectObjects(colliders, true)
    if (hits.length > 0) return hits[0].point.y
    return null
}

// detectar colisión lateral
function detectHorizontalCollision(newPos) {
    const boxSize = new THREE.Vector3(0.45, 1.0, 0.45)

    const tempBox = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(newPos.x, newPos.y + 0.5, newPos.z),
        boxSize
    )

    for (let o of colliders) {
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

/**
 * Animate
 */
const clock = new THREE.Clock()
let initialGroundSet = false

function tick() {
    const dt = clock.getDelta()

    if (mixer) mixer.update(dt)

    if (model) {
        if (!initialGroundSet && colliders.length > 0) {
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
            idleAction.stop()
            walkAction.play()
        } else {
            walkAction.stop()
            idleAction.play()
        }

        if (isMoving) {
            // Dirección relativa a cámara
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

            // Averiguar la Y del suelo en nextPos
            const nextY = getGroundYAtPosition(nextPos)

            if (nextY !== null) {
                const next = nextPos.clone()
                next.y = nextY + modelGroundOffset

                // Detectar colisión lateral sin que el suelo misma bloquee
                if (!detectHorizontalCollision(next)) {
                    model.position.copy(next)
                }

                // Rotación hacia dirección de movimiento
                const targetRot = new THREE.Quaternion()
                targetRot.setFromUnitVectors(new THREE.Vector3(0, 0, 1), moveDir)
                model.quaternion.slerp(targetRot, rotationSpeed * dt)
            }
        }

        // Mantener pies en el muelle 
        const gy = getGroundYAtPosition(model.position)
        if (gy !== null) model.position.y = gy + modelGroundOffset

        updateCameraFollow()
    }

    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
}

tick()
