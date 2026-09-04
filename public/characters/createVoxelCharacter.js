import * as THREE from 'three'

const color = (value) => new THREE.Color(value)

export function createVoxelCharacter(data) {
  const character = new THREE.Group()
  character.name = data.name

  const materials = new Map()
  const mat = (hex, roughness = 0.78, metalness = 0.02) => {
    const key = `${hex}-${roughness}-${metalness}`
    if (!materials.has(key)) {
      materials.set(
        key,
        new THREE.MeshStandardMaterial({
          color: color(hex),
          roughness,
          metalness,
          flatShading: true,
        }),
      )
    }
    return materials.get(key)
  }

  const skin = mat(data.skin)
  const shirt = mat(data.shirt)
  const accent = mat(data.accent, 0.65)
  const pants = mat(data.pants)
  const shoes = mat(data.shoes)
  const hair = mat(data.hair)
  const eye = mat(data.eye)
  const white = mat('#f6f1e5')
  const dark = mat('#171816')

  const box = (name, size, position, material, parent = character, rotation = null) => {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2])
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  const isRobot = data.build === 'robot'
  const isAlien = data.build === 'alien'
  const compact = isAlien ? 0.9 : 1
  const bodyY = 1.48

  // Legs and shoes
  const leftLeg = new THREE.Group()
  const rightLeg = new THREE.Group()
  leftLeg.position.set(-0.235, 0.9, 0)
  rightLeg.position.set(0.235, 0.9, 0)
  character.add(leftLeg, rightLeg)
  const leftKnee = new THREE.Group()
  const rightKnee = new THREE.Group()
  leftKnee.position.y = -0.38
  rightKnee.position.y = -0.38
  leftLeg.add(leftKnee)
  rightLeg.add(rightKnee)
  box('left-thigh', [0.32, 0.4, 0.34], [0, -0.19, 0], pants, leftLeg)
  box('right-thigh', [0.32, 0.4, 0.34], [0, -0.19, 0], pants, rightLeg)
  box('left-lower-leg', [0.32, 0.4, 0.34], [0, -0.19, 0], pants, leftKnee)
  box('right-lower-leg', [0.32, 0.4, 0.34], [0, -0.19, 0], pants, rightKnee)
  box('left-shoe', [0.38, 0.23, 0.52], [0, -0.4, 0.08], shoes, leftKnee)
  box('right-shoe', [0.38, 0.23, 0.52], [0, -0.4, 0.08], shoes, rightKnee)

  // Torso and graphic details
  box('torso', [0.96 * compact, 0.96, 0.54], [0, bodyY, 0], shirt)
  box('shirt-band', [0.98 * compact, 0.16, 0.565], [0, bodyY + 0.19, 0.012], accent)
  if (isRobot) {
    box('chest-screen', [0.46, 0.25, 0.08], [0, bodyY + 0.04, 0.31], dark)
    box('chest-light', [0.26, 0.08, 0.025], [0, bodyY + 0.04, 0.365], accent)
  } else {
    box('chest-pixel', [0.23, 0.23, 0.07], [0, bodyY - 0.05, 0.31], white)
    box('chest-pixel-cut', [0.09, 0.09, 0.025], [0.055, bodyY - 0.02, 0.36], shirt)
  }

  // Jointed arms make the idle pose feel alive.
  const leftArm = new THREE.Group()
  const rightArm = new THREE.Group()
  leftArm.position.set(-0.63 * compact, bodyY + 0.18, 0)
  rightArm.position.set(0.63 * compact, bodyY + 0.18, 0)
  character.add(leftArm, rightArm)
  const leftElbow = new THREE.Group()
  const rightElbow = new THREE.Group()
  leftElbow.position.y = -0.4
  rightElbow.position.y = -0.4
  leftArm.add(leftElbow)
  rightArm.add(rightElbow)
  box('left-sleeve', [0.28, 0.42, 0.4], [0, -0.2, 0], shirt, leftArm)
  box('right-sleeve', [0.28, 0.42, 0.4], [0, -0.2, 0], shirt, rightArm)
  box('left-forearm', [0.27, 0.43, 0.36], [0, -0.2, 0], isRobot ? mat('#8e979e', 0.4, 0.45) : skin, leftElbow)
  box('right-forearm', [0.27, 0.43, 0.36], [0, -0.2, 0], isRobot ? mat('#8e979e', 0.4, 0.45) : skin, rightElbow)

  const coffeeCup = new THREE.Group()
  coffeeCup.name = 'coffee-cup'
  coffeeCup.position.set(0, -0.58, 0.09)
  coffeeCup.scale.setScalar(0.01)
  coffeeCup.visible = false
  coffeeCup.userData.amount = 0
  rightElbow.add(coffeeCup)
  box('cup-body', [0.3, 0.28, 0.3], [0, 0, 0], white, coffeeCup)
  box('coffee', [0.235, 0.025, 0.235], [0, 0.15, 0], dark, coffeeCup)
  box('cup-mark', [0.09, 0.09, 0.025], [0, -0.01, 0.162], accent, coffeeCup)
  box('cup-handle-top', [0.14, 0.07, 0.12], [0.19, 0.07, 0], white, coffeeCup)
  box('cup-handle-side', [0.07, 0.17, 0.12], [0.245, -0.015, 0], white, coffeeCup)
  box('cup-handle-bottom', [0.14, 0.07, 0.12], [0.19, -0.1, 0], white, coffeeCup)

  // Face and eyes
  const head = new THREE.Group()
  head.position.set(0, 2.47, 0)
  character.add(head)
  box('head', [0.98, 0.88, 0.78], [0, 0, 0], isRobot ? mat('#9ba2a7', 0.42, 0.4) : skin, head)

  if (isRobot) {
    box('face-panel', [0.78, 0.43, 0.07], [0, -0.01, 0.425], dark, head)
    box('left-eye', [0.17, 0.09, 0.035], [-0.23, 0, 0.475], accent, head)
    box('right-eye', [0.17, 0.09, 0.035], [0.23, 0, 0.475], accent, head)
  } else {
    const eyeWidth = isAlien ? 0.15 : 0.13
    const eyeHeight = isAlien ? 0.27 : 0.19
    box('left-eye-white', [eyeWidth + 0.08, eyeHeight + 0.05, 0.055], [-0.23, 0.02, 0.415], white, head)
    box('right-eye-white', [eyeWidth + 0.08, eyeHeight + 0.05, 0.055], [0.23, 0.02, 0.415], white, head)
    box('left-eye', [eyeWidth, eyeHeight, 0.035], [-0.21, 0.01, 0.46], eye, head)
    box('right-eye', [eyeWidth, eyeHeight, 0.035], [0.21, 0.01, 0.46], eye, head)
    box('nose', [0.09, 0.08, 0.055], [0, -0.13, 0.43], mat(data.skin, 0.8), head)
    box('mouth', [0.22, 0.055, 0.035], [0, -0.28, 0.435], data.id === 'koda' ? accent : dark, head)
  }

  addHairAndAccessory({ data, head, box, mat, hair, accent, shirt, skin, dark, white })

  // Small profile-specific silhouette changes.
  if (data.build === 'street') {
    box('overshirt-left', [0.12, 0.84, 0.08], [-0.37, bodyY - 0.04, 0.32], accent)
    box('overshirt-right', [0.12, 0.84, 0.08], [0.37, bodyY - 0.04, 0.32], accent)
  }
  if (data.build === 'wizard') {
    box('beard-center', [0.5, 0.35, 0.12], [0, 2.11, 0.38], hair)
    box('beard-tip', [0.25, 0.28, 0.1], [0, 1.86, 0.35], hair)
    box('belt', [0.99, 0.16, 0.58], [0, 1.17, 0], dark)
    box('buckle', [0.2, 0.18, 0.07], [0, 1.17, 0.33], accent)
  }
  if (data.build === 'pilot') {
    box('scarf', [0.82, 0.17, 0.6], [0, 2.0, 0], accent)
    box('scarf-tail', [0.18, 0.52, 0.14], [0.44, 1.77, -0.19], accent, character, [0, 0, -0.18])
  }

  character.userData.parts = {
    head,
    leftArm,
    rightArm,
    leftElbow,
    rightElbow,
    leftLeg,
    rightLeg,
    leftKnee,
    rightKnee,
    coffeeCup,
  }
  character.userData.materials = [...materials.values()]
  character.userData.dispose = () => {
    character.traverse((object) => {
      if (object.isMesh) object.geometry.dispose()
    })
    materials.forEach((material) => material.dispose())
  }

  return character
}

function addHairAndAccessory({ data, head, box, mat, hair, accent, shirt, skin, dark, white }) {
  const frontZ = 0.08

  const coveredHair = ['cap', 'wizard', 'hood'].includes(data.accessory)

  if (!['robot', 'alien'].includes(data.build) && !coveredHair) {
    box('hair-top', [1.04, 0.23, 0.84], [0, 0.49, -0.01], hair, head)
    box('hair-back', [1.03, 0.65, 0.2], [0, 0.15, -0.46], hair, head)
    box('hair-left', [0.18, 0.54, 0.82], [-0.51, 0.18, -0.01], hair, head)
    box('hair-right', [0.18, 0.54, 0.82], [0.51, 0.18, -0.01], hair, head)
    box('fringe-left', [0.3, 0.25, 0.12], [-0.31, 0.34, 0.4], hair, head)
  }

  switch (data.accessory) {
    case 'visor':
      box('visor-band', [1.14, 0.28, 0.18], [0, 0.09, 0.43], dark, head)
      box('visor-glass', [0.72, 0.19, 0.06], [0, 0.08, 0.55], mat('#35d8dc', 0.22, 0.2), head)
      box('visor-shine', [0.22, 0.04, 0.025], [-0.18, 0.12, 0.59], white, head)
      break
    case 'sprout':
      box('brow', [0.82, 0.16, 0.08], [0, 0.28, 0.43], hair, head)
      box('sprout-stem', [0.12, 0.36, 0.12], [0.02, 0.63, 0], hair, head, [0, 0, -0.2])
      box('sprout-left', [0.34, 0.18, 0.18], [-0.15, 0.79, 0], accent, head, [0, 0, 0.24])
      box('sprout-right', [0.34, 0.18, 0.18], [0.18, 0.76, 0], accent, head, [0, 0, -0.24])
      break
    case 'headphones':
      box('headband', [1.12, 0.15, 0.65], [0, 0.48, -0.02], accent, head)
      box('left-earcup', [0.2, 0.46, 0.48], [-0.6, 0.04, 0], accent, head)
      box('right-earcup', [0.2, 0.46, 0.48], [0.6, 0.04, 0], accent, head)
      box('earcup-dark-l', [0.04, 0.23, 0.24], [-0.71, 0.04, frontZ], dark, head)
      box('earcup-dark-r', [0.04, 0.23, 0.24], [0.71, 0.04, frontZ], dark, head)
      break
    case 'antenna':
      box('antenna-stem', [0.09, 0.4, 0.09], [0.24, 0.65, 0], dark, head)
      box('antenna-light', [0.2, 0.2, 0.2], [0.24, 0.9, 0], accent, head)
      box('ear-panel-l', [0.18, 0.42, 0.44], [-0.58, 0, 0], accent, head)
      box('ear-panel-r', [0.18, 0.42, 0.44], [0.58, 0, 0], accent, head)
      break
    case 'cap':
      // A cap gets its own lower hair silhouette. Keeping the generic hair-top
      // here would leave coplanar cube faces and visible WebGL z-fighting.
      box('cap-hair-back', [1.02, 0.42, 0.16], [0, 0.06, -0.47], hair, head)
      box('cap-hair-left', [0.17, 0.48, 0.72], [-0.51, 0.04, -0.02], hair, head)
      box('cap-hair-right', [0.17, 0.48, 0.72], [0.51, 0.04, -0.02], hair, head)
      box('cap-fringe', [0.28, 0.16, 0.09], [-0.32, 0.29, 0.41], hair, head)
      box('cap-crown', [1.1, 0.34, 0.84], [0, 0.48, -0.01], shirt, head)
      box('cap-front', [0.84, 0.26, 0.14], [0, 0.39, 0.43], shirt, head)
      box('cap-brim', [0.72, 0.1, 0.35], [0.08, 0.27, 0.57], accent, head)
      break
    case 'mohawk':
      box('mohawk-back', [0.28, 0.52, 0.32], [0, 0.72, -0.26], accent, head, [0.08, 0, 0])
      box('mohawk-mid', [0.3, 0.65, 0.32], [0, 0.81, 0.02], accent, head)
      box('mohawk-front', [0.28, 0.48, 0.28], [0, 0.69, 0.29], accent, head, [-0.08, 0, 0])
      break
    case 'ponytail':
      box('hair-fringe-right', [0.38, 0.2, 0.12], [0.27, 0.37, 0.4], hair, head)
      box('pony-top', [0.42, 0.4, 0.4], [0.51, 0.28, -0.42], hair, head, [0, 0, -0.25])
      box('pony-tail', [0.38, 0.64, 0.38], [0.69, -0.12, -0.42], hair, head, [0, 0, -0.25])
      break
    case 'goggles':
      box('goggle-strap', [1.1, 0.11, 0.12], [0, 0.18, 0.43], dark, head)
      box('goggle-left', [0.4, 0.27, 0.09], [-0.25, 0.16, 0.5], accent, head)
      box('goggle-right', [0.4, 0.27, 0.09], [0.25, 0.16, 0.5], accent, head)
      box('lens-left', [0.25, 0.15, 0.035], [-0.25, 0.16, 0.56], mat('#6fd9e5', 0.18, 0.1), head)
      box('lens-right', [0.25, 0.15, 0.035], [0.25, 0.16, 0.56], mat('#6fd9e5', 0.18, 0.1), head)
      break
    case 'wizard':
      box('hat-brim', [1.42, 0.14, 1.08], [0, 0.53, 0], shirt, head)
      box('hat-base', [0.92, 0.34, 0.74], [0, 0.75, -0.02], shirt, head)
      box('hat-mid', [0.67, 0.38, 0.58], [0.08, 1.03, -0.04], shirt, head, [0, 0, -0.08])
      box('hat-tip', [0.39, 0.37, 0.42], [0.2, 1.31, -0.05], shirt, head, [0, 0, -0.18])
      box('hat-band', [0.96, 0.13, 0.78], [0, 0.64, 0], accent, head)
      break
    case 'hood':
      box('hood-top', [1.16, 0.24, 0.9], [0, 0.5, -0.01], shirt, head)
      box('hood-left', [0.24, 0.83, 0.9], [-0.55, 0.06, -0.01], shirt, head)
      box('hood-right', [0.24, 0.83, 0.9], [0.55, 0.06, -0.01], shirt, head)
      box('hood-back', [1.16, 0.78, 0.2], [0, 0.06, -0.48], shirt, head)
      box('mask', [0.76, 0.22, 0.08], [0, -0.23, 0.44], accent, head)
      break
  }
}

export function setCharacterOpacity(character, opacity) {
  character.userData.materials.forEach((material) => {
    material.transparent = opacity < 0.999
    material.opacity = opacity
    material.depthWrite = opacity > 0.5
  })
}
