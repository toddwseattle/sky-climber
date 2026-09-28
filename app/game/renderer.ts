import * as THREE from "three";
import { GAME } from "./config";
import type { GameSnapshot, Grip, HandId, HazardState } from "./types";

export type Quality = "low" | "high";

function gripPosition(grip: Grip): THREE.Vector3 {
  return new THREE.Vector3(
    (grip.col - (GAME.columns - 1) / 2) * GAME.columnWidth,
    (grip.row - 1) * GAME.floorHeight + 1.2,
    0.72,
  );
}

function handPosition(snapshot: GameSnapshot, handId: HandId): THREE.Vector3 {
  const hand = snapshot[handId];
  if (hand.moving) {
    const t = hand.moving.progress * hand.moving.progress * (3 - 2 * hand.moving.progress);
    return gripPosition(hand.moving.from).lerp(gripPosition(hand.moving.to), t);
  }
  const position = gripPosition(hand.grip);
  if (hand.state === "dangling") {
    position.y -= 0.9;
    position.x += handId === "left" ? -0.35 : 0.35;
    position.z += 0.35;
  }
  return position;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}

function taperedPrismGeometry(
  bottomWidth: number,
  topWidth: number,
  height: number,
  bottomDepth: number,
  topDepth: number,
): THREE.BufferGeometry {
  const y0 = -height / 2;
  const y1 = height / 2;
  const vertices = new Float32Array([
    -bottomWidth / 2, y0, bottomDepth / 2,
    bottomWidth / 2, y0, bottomDepth / 2,
    bottomWidth / 2, y0, -bottomDepth / 2,
    -bottomWidth / 2, y0, -bottomDepth / 2,
    -topWidth / 2, y1, topDepth / 2,
    topWidth / 2, y1, topDepth / 2,
    topWidth / 2, y1, -topDepth / 2,
    -topWidth / 2, y1, -topDepth / 2,
  ]);
  const indices = [
    0, 3, 2, 0, 2, 1,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class SkyClimberRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 0.1, 420);
  private readonly clock = new THREE.Clock();
  private readonly climber = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly leftHand: THREE.Group;
  private readonly rightHand: THREE.Group;
  private readonly leftArm: THREE.Mesh;
  private readonly rightArm: THREE.Mesh;
  private readonly leftLeg: THREE.Mesh;
  private readonly rightLeg: THREE.Mesh;
  private readonly hazardRoot = new THREE.Group();
  private readonly hazardMeshes = new Map<number, THREE.Group>();
  private readonly recoveryRoot = new THREE.Group();
  private readonly tower = new THREE.Group();
  private readonly summit = new THREE.Group();
  private readonly helicopter = new THREE.Group();
  private readonly windParticles = new THREE.Group();
  private snapshot: GameSnapshot | null = null;
  private quality: Quality;
  private reducedMotion: boolean;
  private introTime = 0;
  private resizeObserver: ResizeObserver;
  private readonly onContextLost: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: { quality: Quality; reducedMotion: boolean; onContextLost: () => void },
  ) {
    this.quality = options.quality;
    this.reducedMotion = options.reducedMotion;
    this.onContextLost = options.onContextLost;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: options.quality === "high",
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = options.quality === "high";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x161535);
    this.scene.fog = new THREE.FogExp2(0x3c3862, 0.0042);
    this.scene.add(this.tower, this.climber, this.hazardRoot, this.recoveryRoot, this.summit);
    this.buildWorld();
    const character = this.buildClimber();
    this.body = character.body;
    this.head = character.head;
    this.leftHand = character.leftHand;
    this.rightHand = character.rightHand;
    this.leftArm = character.leftArm;
    this.rightArm = character.rightArm;
    this.leftLeg = character.leftLeg;
    this.rightLeg = character.rightLeg;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.resize();
  }

  setSnapshot(snapshot: GameSnapshot): void {
    this.snapshot = snapshot;
  }

  projectGrip(grip: Grip): { grip: Grip; x: number; y: number; visible: boolean } {
    const projected = gripPosition(grip).project(this.camera);
    const bounds = this.canvas.getBoundingClientRect();
    return {
      grip: { ...grip },
      x: bounds.left + (projected.x + 1) * bounds.width / 2,
      y: bounds.top + (1 - projected.y) * bounds.height / 2,
      visible:
        projected.z >= -1 &&
        projected.z <= 1 &&
        projected.x >= -1.08 &&
        projected.x <= 1.08 &&
        projected.y >= -1.08 &&
        projected.y <= 1.08,
    };
  }

  setOptions(options: { quality: Quality; reducedMotion: boolean }): void {
    this.quality = options.quality;
    this.reducedMotion = options.reducedMotion;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = options.quality === "high";
    this.resize();
  }

  render(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.introTime += dt;
    if (this.snapshot) {
      this.updateClimber(this.snapshot, dt);
      this.updateHazards(this.snapshot);
      this.updateCamera(this.snapshot, dt);
      this.updateAtmosphere(this.snapshot, dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer.dispose();
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.onContextLost();
  };

  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 1.75 : 1);
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private buildWorld(): void {
    const hemi = new THREE.HemisphereLight(0x9fb7ff, 0x1c1734, 1.6);
    const key = new THREE.DirectionalLight(0xffc59d, 3.2);
    key.position.set(-8, 38, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -20;
    this.scene.add(hemi, key);

    const facadeGeometry = new THREE.BoxGeometry(0.98, 0.92, 0.28);
    const facadeMaterial = new THREE.MeshStandardMaterial({
      color: 0x256a78,
      roughness: 0.28,
      metalness: 0.42,
      emissive: 0x0b2637,
      emissiveIntensity: 0.55,
    });
    const windows = new THREE.InstancedMesh(
      facadeGeometry,
      facadeMaterial,
      GAME.columns * GAME.floors,
    );
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let instance = 0;
    for (let row = 1; row <= GAME.floors; row += 1) {
      for (let col = 0; col < GAME.columns; col += 1) {
        const p = gripPosition({ col, row });
        matrix.makeTranslation(p.x, p.y, 0.18);
        windows.setMatrixAt(instance, matrix);
        const warm = (row * 11 + col * 17) % 13 === 0;
        color.setHex(warm ? 0xe4a869 : row > 80 ? 0x347e86 : 0x286b79);
        windows.setColorAt(instance, color);
        instance += 1;
      }
    }
    windows.receiveShadow = true;
    this.tower.add(windows);

    const gripGeometry = new THREE.CylinderGeometry(0.115, 0.115, 0.56, 10);
    gripGeometry.rotateZ(Math.PI / 2);
    const gripMaterial = new THREE.MeshStandardMaterial({
      color: 0xc3f5e8,
      emissive: 0x2ec2b2,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    });
    const grips = new THREE.InstancedMesh(gripGeometry, gripMaterial, GAME.columns * GAME.floors);
    instance = 0;
    for (let row = 1; row <= GAME.floors; row += 1) {
      for (let col = 0; col < GAME.columns; col += 1) {
        const p = gripPosition({ col, row });
        matrix.makeTranslation(p.x, p.y, p.z);
        grips.setMatrixAt(instance++, matrix);
      }
    }
    this.tower.add(grips);

    this.buildTaipeiSilhouette();

    const spireBaseY = GAME.floors * GAME.floorHeight + 1.5;
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.42, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xb7d9d5, metalness: 0.8, roughness: 0.22 }),
    );
    spire.position.y = spireBaseY + 7;
    this.summit.add(spire);
    this.buildHelicopter(spireBaseY);

    this.buildCity();
    this.buildWindParticles();
  }

  private buildTaipeiSilhouette(): void {
    const glass = new THREE.MeshStandardMaterial({
      color: 0x174d58,
      roughness: 0.36,
      metalness: 0.38,
      emissive: 0x092431,
      emissiveIntensity: 0.34,
    });
    const darkGlass = new THREE.MeshStandardMaterial({
      color: 0x1a5661,
      emissive: 0x092c36,
      emissiveIntensity: 0.5,
      roughness: 0.44,
      metalness: 0.3,
    });
    const jadeMetal = new THREE.MeshStandardMaterial({
      color: 0x4a9a92,
      roughness: 0.34,
      metalness: 0.56,
    });
    const paleMetal = new THREE.MeshStandardMaterial({
      color: 0xa7c9c2,
      roughness: 0.38,
      metalness: 0.68,
    });

    const addTaperedBody = (
      bottomY: number,
      topY: number,
      bottomWidth: number,
      topWidth: number,
      bottomDepth: number,
      topDepth: number,
      material: THREE.Material = glass,
    ) => {
      const height = topY - bottomY;
      const body = new THREE.Mesh(
        taperedPrismGeometry(bottomWidth, topWidth, height, bottomDepth, topDepth),
        material,
      );
      body.position.set(0, bottomY + height / 2, -Math.max(bottomDepth, topDepth) / 2 - 0.14);
      body.receiveShadow = true;
      this.tower.add(body);
    };

    // Broad, inward-sloping podium and the shoulder below the repeated pagoda tiers.
    addTaperedBody(0, 21, 22.4, 18.7, 7.2, 5.8, darkGlass);
    addTaperedBody(21, 29.4, 18.7, 15.8, 5.8, 5.25);
    const podiumBand = new THREE.Mesh(new THREE.BoxGeometry(19.6, 1.2, 6.15), jadeMetal);
    podiumBand.position.set(0, 21.4, -3.2);
    this.tower.add(podiumBand);
    for (const side of [-1, 1]) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.28, 24), paleMetal);
      coin.rotation.x = Math.PI / 2;
      coin.position.set(side * 6.4, 23.4, 0.72);
      this.tower.add(coin);
    }

    // Eight upward-flaring modules create Taipei 101's unmistakable bamboo rhythm.
    const moduleHeight = 9 * GAME.floorHeight;
    for (let tier = 0; tier < 8; tier += 1) {
      const bottomY = 21 * GAME.floorHeight + tier * moduleHeight;
      const topY = bottomY + moduleHeight - 0.42;
      const bottomWidth = 15.45 - tier * 0.2;
      const topWidth = bottomWidth + 2.5;
      const bottomDepth = 5.05 - tier * 0.08;
      const topDepth = bottomDepth + 0.58;
      addTaperedBody(bottomY, topY, bottomWidth, topWidth, bottomDepth, topDepth);

      const ledgeDepth = topDepth + 0.72;
      const ledge = new THREE.Mesh(
        new THREE.BoxGeometry(topWidth + 1.15, 0.56, ledgeDepth),
        jadeMetal,
      );
      ledge.position.set(0, topY + 0.2, -ledgeDepth / 2 - 0.12);
      this.tower.add(ledge);

      const bandDepth = topDepth + 0.22;
      const upperBand = new THREE.Mesh(
        new THREE.BoxGeometry(topWidth + 0.25, 0.22, bandDepth),
        paleMetal,
      );
      upperBand.position.set(0, topY - 0.42, -bandDepth / 2 - 0.12);
      this.tower.add(upperBand);

      for (const side of [-1, 1]) {
        const ornament = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.18, 0.52, 10),
          paleMetal,
        );
        ornament.rotation.x = Math.PI / 2;
        ornament.position.set(side * (topWidth / 2 - 0.42), topY - 0.15, 0.63);
        this.tower.add(ornament);

        const cornerRib = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, moduleHeight - 1.05, 0.22),
          jadeMetal,
        );
        cornerRib.position.set(side * (bottomWidth / 2 - 0.22), bottomY + moduleHeight / 2 - 0.3, 0.12);
        this.tower.add(cornerRib);
      }
    }

    const upperStart = 21 * GAME.floorHeight + 8 * moduleHeight;
    addTaperedBody(upperStart, upperStart + 8.7, 14.05, 9.4, 4.45, 3.8);
    const crownLevels = [
      { y: upperStart + 8.8, width: 10.2, depth: 4.2, height: 0.65 },
      { y: upperStart + 9.65, width: 8.7, depth: 3.65, height: 0.7 },
      { y: upperStart + 10.55, width: 7.25, depth: 3.05, height: 0.78 },
      { y: upperStart + 11.55, width: 5.7, depth: 2.55, height: 1.1 },
    ];
    for (const level of crownLevels) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(level.width, level.height, level.depth),
        level.width > 7 ? jadeMetal : darkGlass,
      );
      slab.position.set(0, level.y, -2.45);
      this.summit.add(slab);
    }
    const antennaBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 1.05, 1.2, 16),
      paleMetal,
    );
    antennaBase.position.set(0, upperStart + 12.6, -2.45);
    this.summit.add(antennaBase);
  }

  private buildCity(): void {
    const city = new THREE.Group();
    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x181a35, roughness: 0.82 });
    const litMaterial = new THREE.MeshBasicMaterial({ color: 0xffbd76 });
    let seed = 1927;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 90; i += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 18 + random() * 62;
      const height = 1.5 + random() * 8;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(1 + random() * 3, height, 1 + random() * 3),
        buildingMaterial,
      );
      building.position.set(Math.cos(angle) * distance, height / 2 - 2, Math.sin(angle) * distance - 10);
      city.add(building);
      if (i % 3 === 0) {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), litMaterial);
        light.position.copy(building.position).add(new THREE.Vector3(0, height * 0.25, 1.2));
        city.add(light);
      }
    }
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(120, 48),
      new THREE.MeshStandardMaterial({ color: 0x111529, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.1;
    city.add(ground);
    this.scene.add(city);
  }

  private buildHelicopter(summitY: number): void {
    const coral = new THREE.MeshStandardMaterial({ color: 0xff655f, roughness: 0.42, metalness: 0.18 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x17213f, roughness: 0.5, metalness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fe6ef, roughness: 0.18, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.65, 1.35, 5, 10), coral);
    body.rotation.z = Math.PI / 2;
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 10), glass);
    cockpit.scale.set(1, 0.72, 0.72);
    cockpit.position.x = -0.72;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.28, 2.6, 8), coral);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = 1.7;
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.055, 0.12), dark);
    rotor.position.y = 0.9;
    rotor.name = "main-rotor";
    const rotorCross = rotor.clone();
    rotorCross.rotation.y = Math.PI / 2;
    rotorCross.name = "main-rotor-cross";
    const skidLeft = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.08), dark);
    const skidRight = skidLeft.clone();
    skidLeft.position.set(-0.1, -0.72, -0.55);
    skidRight.position.set(-0.1, -0.72, 0.55);
    this.helicopter.add(body, cockpit, tail, rotor, rotorCross, skidLeft, skidRight);
    this.helicopter.position.set(10, summitY + 4.5, 5);
    this.helicopter.visible = false;
    this.scene.add(this.helicopter);
  }

  private buildWindParticles(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xc9efff, transparent: true, opacity: 0.42 });
    for (let i = 0; i < 24; i += 1) {
      const streak = new THREE.Mesh(new THREE.BoxGeometry(1.1 + (i % 5) * 0.25, 0.025, 0.025), material);
      streak.position.set(((i * 37) % 19) - 9.5, (i % 12) * 1.4 - 7, 3 + (i % 4));
      this.windParticles.add(streak);
    }
    this.windParticles.visible = false;
    this.scene.add(this.windParticles);
  }

  private buildClimber(): {
    body: THREE.Mesh;
    head: THREE.Mesh;
    leftHand: THREE.Group;
    rightHand: THREE.Group;
    leftArm: THREE.Mesh;
    rightArm: THREE.Mesh;
    leftLeg: THREE.Mesh;
    rightLeg: THREE.Mesh;
  } {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x26386f, roughness: 0.62 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xeaa071, roughness: 0.72 });
    const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x5673c7, roughness: 0.65 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.85, 5, 10), bodyMaterial);
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.43, 16, 12), skinMaterial);
    head.castShadow = true;
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.44, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
      new THREE.MeshStandardMaterial({ color: 0x2d1832, roughness: 0.85 }),
    );
    hair.position.y = 0.13;
    head.add(hair);
    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1, 10), limbMaterial);
    const rightArm = leftArm.clone();
    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1, 10), limbMaterial);
    const rightLeg = leftLeg.clone();
    const leftHand = this.createHand(0xff6d68, "L");
    const rightHand = this.createHand(0xffcd57, "R");
    this.climber.add(body, head, leftArm, rightArm, leftLeg, rightLeg, leftHand, rightHand);
    return { body, head, leftHand, rightHand, leftArm, rightArm, leftLeg, rightLeg };
  }

  private createHand(color: number, label: string): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.16 });
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), material);
    palm.scale.set(1.15, 0.86, 0.72);
    const badgeTexture = document.createElement("canvas");
    badgeTexture.width = badgeTexture.height = 64;
    const context = badgeTexture.getContext("2d");
    if (context) {
      context.fillStyle = "#172044";
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = "bold 38px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, 32, 34);
    }
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(badgeTexture), depthTest: false }));
    badge.scale.set(0.28, 0.28, 0.28);
    badge.position.z = 0.21;
    group.add(palm, badge);
    return group;
  }

  private updateClimber(snapshot: GameSnapshot, dt: number): void {
    const left = handPosition(snapshot, "left");
    const right = handPosition(snapshot, "right");
    const midpoint = left.clone().add(right).multiplyScalar(0.5);
    const bodyTarget = midpoint.clone().add(new THREE.Vector3(0, -1.25, 0.82));
    if (snapshot.phase === "falling") bodyTarget.y -= 2.4;
    this.body.position.lerp(bodyTarget, 1 - Math.pow(0.001, dt));
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, (right.y - left.y) * 0.12, 0.14);
    this.head.position.copy(this.body.position).add(new THREE.Vector3(0, 0.88, 0.02));
    this.leftHand.position.copy(left);
    this.rightHand.position.copy(right);

    const leftShoulder = this.body.position.clone().add(new THREE.Vector3(-0.38, 0.48, 0));
    const rightShoulder = this.body.position.clone().add(new THREE.Vector3(0.38, 0.48, 0));
    this.alignLimb(this.leftArm, leftShoulder, left);
    this.alignLimb(this.rightArm, rightShoulder, right);

    const hipLeft = this.body.position.clone().add(new THREE.Vector3(-0.25, -0.5, 0));
    const hipRight = this.body.position.clone().add(new THREE.Vector3(0.25, -0.5, 0));
    const sway = Math.sin(this.introTime * 3) * 0.08;
    const leftFoot = this.body.position.clone().add(new THREE.Vector3(-0.5 + sway, -1.35, -0.25));
    const rightFoot = this.body.position.clone().add(new THREE.Vector3(0.5 - sway, -1.35, -0.25));
    this.alignLimb(this.leftLeg, hipLeft, leftFoot);
    this.alignLimb(this.rightLeg, hipRight, rightFoot);
    this.climber.visible = snapshot.phase !== "title" && snapshot.phase !== "intro";
  }

  private alignLimb(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    const delta = to.clone().sub(from);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.set(1, delta.length(), 1);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  }

  private updateHazards(snapshot: GameSnapshot): void {
    const activeIds = new Set(snapshot.hazards.map((hazard) => hazard.id));
    for (const [id, object] of this.hazardMeshes) {
      if (!activeIds.has(id)) {
        this.hazardRoot.remove(object);
        disposeObject(object);
        this.hazardMeshes.delete(id);
      }
    }
    for (const hazard of snapshot.hazards) {
      let object = this.hazardMeshes.get(hazard.id);
      if (!object) {
        object = this.createHazard(hazard);
        this.hazardMeshes.set(hazard.id, object);
        this.hazardRoot.add(object);
      }
      this.positionHazard(object, hazard);
    }

    while (this.recoveryRoot.children.length) {
      const child = this.recoveryRoot.children.pop();
      if (child) disposeObject(child);
    }
    if (snapshot.recoveryHand) {
      const origin = snapshot[snapshot.recoveryHand].grip;
      for (const delta of [
        { col: -1, row: 0 },
        { col: 1, row: 0 },
        { col: 0, row: -1 },
        { col: 0, row: 1 },
      ]) {
        const grip = { col: origin.col + delta.col, row: origin.row + delta.row };
        if (grip.col < 0 || grip.col >= GAME.columns || grip.row < 1 || grip.row > GAME.floors) continue;
        const glow = new THREE.Mesh(
          new THREE.TorusGeometry(0.29, 0.065, 8, 18),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
        );
        glow.position.copy(gripPosition(grip));
        glow.rotation.y = Math.PI / 2;
        this.recoveryRoot.add(glow);
      }
    }
  }

  private createHazard(hazard: HazardState): THREE.Group {
    const group = new THREE.Group();
    const coral = new THREE.MeshStandardMaterial({ color: 0xff615d, emissive: 0x912d35, emissiveIntensity: 0.8 });
    if (hazard.type === "window") {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.98, 0.22), coral);
      group.add(shutter);
    } else if (hazard.type === "debris") {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 0.5, 10), coral);
      const leaves = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ color: 0x8ddb8a }));
      leaves.position.y = 0.38;
      group.add(pot, leaves);
    } else if (hazard.type === "bird") {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 8), coral);
      body.rotation.z = Math.PI / 2;
      const wingGeometry = new THREE.BoxGeometry(0.65, 0.08, 0.3);
      const leftWing = new THREE.Mesh(wingGeometry, coral);
      const rightWing = leftWing.clone();
      leftWing.rotation.z = 0.35;
      rightWing.rotation.z = -0.35;
      group.add(body, leftWing, rightWing);
    } else {
      for (let i = 0; i < 3; i += 1) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.65, 8), coral);
        arrow.rotation.z = hazard.windDirection === "left" ? Math.PI / 2 : -Math.PI / 2;
        arrow.position.x = (i - 1) * 0.75;
        group.add(arrow);
      }
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.055, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc4a5, transparent: true, opacity: 0.9 }),
    );
    ring.name = "warning-ring";
    group.add(ring);
    return group;
  }

  private positionHazard(object: THREE.Group, hazard: HazardState): void {
    const p = gripPosition({ col: hazard.col, row: hazard.row });
    object.position.copy(p);
    const ring = object.getObjectByName("warning-ring");
    if (ring) {
      ring.visible = hazard.phase === "warning";
      const pulse = 0.9 + Math.sin(this.introTime * 12) * 0.14;
      ring.scale.setScalar(pulse);
    }
    if (hazard.type === "debris") {
      object.position.y += hazard.phase === "warning" ? 4.2 : 4.2 * (1 - hazard.progress);
      object.rotation.z += 0.06;
    }
    if (hazard.type === "bird") {
      const from = hazard.side === "left" ? -10 : 10;
      const to = -from;
      object.position.x = THREE.MathUtils.lerp(from, to, hazard.phase === "warning" ? 0 : hazard.progress);
      object.position.z = 2.4;
    }
    if (hazard.type === "wind") object.position.z = 2.2;
    object.scale.setScalar(hazard.phase === "warning" ? 0.9 + hazard.progress * 0.18 : 1);
  }

  private updateCamera(snapshot: GameSnapshot, dt: number): void {
    if (snapshot.phase === "title") {
      const angle = this.reducedMotion ? 0.24 : 0.24 + Math.sin(this.introTime * 0.11) * 0.07;
      const target = new THREE.Vector3(0, 73, -1.5);
      this.camera.position.set(Math.sin(angle) * 184, 76, Math.cos(angle) * 184);
      this.camera.lookAt(target);
      return;
    }
    if (snapshot.phase === "intro") {
      const t = snapshot.introProgress;
      const eased = t * t * (3 - 2 * t);
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(84, 72, 208),
        new THREE.Vector3(34, 94, 158),
        new THREE.Vector3(-28, 80, 108),
        new THREE.Vector3(19, 43, 58),
        new THREE.Vector3(5.4, 7, 18.5),
      ]);
      this.camera.position.copy(path.getPointAt(eased));
      const targetY = t < 0.58
        ? THREE.MathUtils.lerp(72, 84, t / 0.58)
        : THREE.MathUtils.lerp(84, 4.2, (t - 0.58) / 0.42);
      this.camera.lookAt(new THREE.Vector3(0, targetY, -1));
      return;
    }
    const left = handPosition(snapshot, "left");
    const right = handPosition(snapshot, "right");
    const bodyY = (left.y + right.y) / 2 - 1.2;
    const desired = new THREE.Vector3(5.4, Math.max(7, bodyY + 5.4), 18.5);
    if (snapshot.phase === "victory") desired.set(10, GAME.floors * GAME.floorHeight + 9, 25);
    const rate = this.reducedMotion ? 1 : 1 - Math.pow(0.025, dt);
    this.camera.position.lerp(desired, rate);
    const lookAt = new THREE.Vector3(0, bodyY + 4.2, 0);
    if (snapshot.phase === "victory") lookAt.y = GAME.floors * GAME.floorHeight + 3;
    this.camera.lookAt(lookAt);
  }

  private updateAtmosphere(snapshot: GameSnapshot, dt: number): void {
    const windActive = snapshot.hazards.some((hazard) => hazard.type === "wind" && hazard.phase === "active");
    this.windParticles.visible = windActive && !this.reducedMotion;
    if (this.windParticles.visible) {
      const bodyY = (handPosition(snapshot, "left").y + handPosition(snapshot, "right").y) / 2;
      this.windParticles.position.y = bodyY;
      this.windParticles.position.x += dt * 9;
      if (this.windParticles.position.x > 10) this.windParticles.position.x = -10;
    }
    this.helicopter.visible = snapshot.phase === "victory";
    if (this.helicopter.visible) {
      this.helicopter.position.x = 8 + Math.sin(this.introTime * 0.7) * 1.4;
      this.helicopter.position.y = GAME.floors * GAME.floorHeight + 6 + Math.sin(this.introTime * 1.5) * 0.22;
      const rotor = this.helicopter.getObjectByName("main-rotor");
      const rotorCross = this.helicopter.getObjectByName("main-rotor-cross");
      if (rotor) rotor.rotation.y += dt * 24;
      if (rotorCross) rotorCross.rotation.y += dt * 24;
    }
  }
}
