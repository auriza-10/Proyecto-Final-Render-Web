import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'lil-gui'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'


const gui = new GUI()
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()


const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: '#444444', metalness: 0, roughness: 0.5 })
)
floor.receiveShadow = true
floor.rotation.x = -Math.PI * 0.5
scene.add(floor)

// luces
const ambientLight = new THREE.AmbientLight(0xffffff, 2.4)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.8)
directionalLight.castShadow = true
directionalLight.position.set(5, 5, 5)
scene.add(directionalLight)


const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

// cámara
const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 100)
camera.position.set(2, 2, 2)
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 0.75, 0)
controls.enableDamping = true

// renderer
const renderer = new THREE.WebGLRenderer({
    canvas: canvas
})
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

// Modelo y animaciones
let xiao = null
let mixer = null
let idleAction = null
let walkAction = null

const speed = 3
const rotationSpeed = 4

const keys = { w: false, a: false, s: false, d: false }

window.addEventListener("keydown", e => {
    if (keys[e.key.toLowerCase()] !== undefined) keys[e.key.toLowerCase()] = true
})

window.addEventListener("keyup", e => {
    if (keys[e.key.toLowerCase()] !== undefined) keys[e.key.toLowerCase()] = false
})

const gltfLoader = new GLTFLoader()

// Escenario
gltfLoader.load('/models/comisaria/scene.gltf', gltf => {
    scene.add(gltf.scene)
})

// Personaje Xiao
gltfLoader.load('/models/xiaowalk.gltf', gltf => {

    xiao = gltf.scene
    xiao.scale.set(1, 1, 1)
    xiao.position.set(0, 0, 0)
    scene.add(xiao)

    mixer = new THREE.AnimationMixer(xiao)

    walkAction = mixer.clipAction(gltf.animations[0])

    const idleClip = THREE.AnimationUtils.subclip(gltf.animations[0], 'idle', 0, 1)
    idleAction = mixer.clipAction(idleClip)

    idleAction.play()
})

// Animación
const clock = new THREE.Clock()
let previousTime = 0

function tick() {
    const elapsed = clock.getElapsedTime()
    const delta = elapsed - previousTime
    previousTime = elapsed

    if (mixer) mixer.update(delta)

    if (xiao) {
        const vel = new THREE.Vector3()

        if (keys.w) vel.z -= 1
        if (keys.s) vel.z += 1
        if (keys.a) vel.x -= 1
        if (keys.d) vel.x += 1

        const moving = vel.length() > 0

        if (moving) {
            idleAction.stop()
            walkAction.play()

            vel.normalize()
            xiao.position.addScaledVector(vel, speed * delta)

            const targetDir = vel.clone().normalize()
            const targetQuat = new THREE.Quaternion()
            targetQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), targetDir)
            xiao.quaternion.slerp(targetQuat, rotationSpeed * delta)

        } else {
            walkAction.stop()
            idleAction.play()
        }
    }

    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
}

tick()
