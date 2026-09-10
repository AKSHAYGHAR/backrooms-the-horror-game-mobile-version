import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Level } from "./level";
import { EntityContext } from "./entity";
import { mulberry32, Rand, randRange } from "./rng";

/**
 * Pennywise — a GLTF-loaded entity for Level 2.
 * No embedded animations: all movement is procedural.
 */
export class PennywiseEntity {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  heading = 0;
  state: "dormant" | "roam" | "stalk" | "chase" = "dormant";
  frozen = false;

  onScreech: (() => void) | null = null;
  onStep: (() => void) | null = null;
  onKill: (() => void) | null = null;

  private path: { x: number; z: number }[] = [];
  private waypoint: { x: number; z: number } | null = null;
  private walkPhase = 0;
  private screechTimer = 0;
  private repathTimer = 0;
  private lastKnownPlayer = new THREE.Vector3();
  private losLostTime = 0;
  private observedTime = 0;
  private farFromPlayerTime = 0;

  private rng: Rand;

  // GLTF model
  private modelRoot?: THREE.Group;
  private modelLoaded = false;
  private timeOffset = Math.random() * 100;
  private twitchTimer = 1;
  private twitchT = 0;
  private twitchVec = new THREE.Vector3();
  private vHead = new THREE.Vector3();

  // Bones for procedural animation
  private bHead?: THREE.Bone;
  private bSpine?: THREE.Bone;
  private bArmL?: THREE.Bone;
  private bArmR?: THREE.Bone;
  private bLegL?: THREE.Bone;
  private bLegR?: THREE.Bone;
  private bKneeL?: THREE.Bone;
  private bKneeR?: THREE.Bone;
  private initQuats = new Map<THREE.Bone, THREE.Quaternion>();
  
  // Materials that will glow in the dark
  private glowMats: THREE.MeshStandardMaterial[] = [];

  constructor(private level: Level, seed: number) {
    this.rng = mulberry32(seed ^ 0xdead);
    this.root.visible = false;
    this.loadModel();
  }

  private loadModel() {
    const loader = new GLTFLoader();
    loader.load(
      "/models/pennywise.glb",
      (gltf) => {
        this.modelRoot = gltf.scene;

        // Fit model under 3m ceiling
        this.modelRoot.scale.setScalar(0.35);
        // Face standard -Z direction
        this.modelRoot.rotation.y = Math.PI;

        // Extract bones by name based on the hierarchy we inspected
        this.modelRoot.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const mesh = child as THREE.Mesh;
            if (mesh.material) {
              const mat = mesh.material as THREE.MeshStandardMaterial;
              if (mat.roughness !== undefined) {
                mat.roughness = Math.max(mat.roughness, 0.55);
              }
              // Collect eyes and teeth for the dark-glow effect
              const mName = mat.name;
              if (
                mName === "eye_color.002" || 
                mName === "final_eyes.001" || 
                mName === "dead_lights.001" || 
                mName === "teeth.001"
              ) {
                this.glowMats.push(mat);
              }
            }
          }
          if ((child as THREE.Bone).isBone) {
            const bone = child as THREE.Bone;
            if (bone.name === "Bone004_05" || bone.name.includes("004_05")) { this.bHead = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
            if (bone.name === "Bone003_04" || bone.name.includes("003_04")) { this.bSpine = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
            if (bone.name === "Bone026_023" || bone.name.includes("026_023")) { this.bArmL = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
            if (bone.name === "Bone005_06" || bone.name.includes("005_06")) { this.bArmR = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
            if (bone.name === "Bone008_040" || bone.name.includes("008_040")) { this.bLegL = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
            if (bone.name === "Bone029_044" || bone.name.includes("029_044")) { this.bLegR = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
            if (bone.name === "Bone009_041" || bone.name.includes("009_041")) { this.bKneeL = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
            if (bone.name === "Bone030_045" || bone.name.includes("030_045")) { this.bKneeR = bone; this.initQuats.set(bone, bone.quaternion.clone()); }
          }
        });

        this.root.add(this.modelRoot);
        this.modelLoaded = true;
        console.log("[Pennywise] Model loaded successfully");
      },
      undefined,
      (error) => {
        console.error("[Pennywise] Failed to load model:", error);
      },
    );
  }

  get headWorldPos(): THREE.Vector3 {
    const head = new THREE.Vector3(0, 1.8, 0);
    head.applyMatrix4(this.root.matrixWorld);
    return head;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.root);
  }

  removeFrom(scene: THREE.Scene) {
    scene.remove(this.root);
  }

  activate() {
    if (this.state !== "dormant") return;
    const c = this.level.entitySpawnCell;
    this.teleportToCell(c.x, c.z);
    this.setState("roam");
  }



  private teleportToCell(cx: number, cz: number) {
    this.pos.set(this.level.worldX(cx), 0, this.level.worldZ(cz));
    this.path = [];
    this.waypoint = null;
  }

  private setState(s: typeof this.state) {
    if (this.state === s) return;
    this.state = s;
    this.path = [];
    this.waypoint = null;
    if (s === "chase") {
      this.screechTimer = 0.5;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  update — called each frame by Engine.loop                          */
  /* ------------------------------------------------------------------ */

  update(dt: number, ctx: EntityContext): void {
    if (this.state === "dormant") {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    // ----- SENSES -----
    const dist = this.pos.distanceTo(ctx.playerPos);
    const myCell = this.level.cellOf(this.pos.x, this.pos.z);
    const pCell = this.level.cellOf(ctx.playerPos.x, ctx.playerPos.z);
    const los = this.level.lineOfSight(myCell.x, myCell.z, pCell.x, pCell.z);

    let canSee = false;
    if (los) {
      if (dist < 5 && !ctx.playerSneaking) canSee = true;
      else if (dist < 2.5) canSee = true;
      else if (ctx.flashlightOn) canSee = true;
    }

    // State transitions
    if (this.state === "roam") {
      if (canSee) this.setState("chase");
      else if (dist < 18 && !ctx.playerSneaking && this.rng() < 0.05) this.setState("stalk");
    } else if (this.state === "stalk") {
      if (canSee) this.setState("chase");
      else if (dist > 30) this.setState("roam");
    } else if (this.state === "chase") {
      if (!los && dist > 15) this.setState("stalk");
    }

    // Pennywise does not freeze from the flashlight!
    this.frozen = false;

    // ----- MOVEMENT -----
    let speed = 0;
    if (!this.frozen) {
      if (this.state === "roam") speed = 1.3;
      else if (this.state === "stalk") speed = 2.15;
      else if (this.state === "chase") speed = 4.55;
    }

    this.repathTimer -= dt;
    if (this.repathTimer <= 0 && !this.frozen) {
      this.repathTimer = this.state === "chase" ? 0.35 : 0.8;
      this.computePath(ctx.playerPos);
    }

    const directSteer = !this.frozen && this.state === "chase" && los && dist < 7;

    if (directSteer && speed > 0) {
      const dx = ctx.playerPos.x - this.pos.x;
      const dz = ctx.playerPos.z - this.pos.z;
      const targetHeading = Math.atan2(-dx, -dz);
      let diff = targetHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 10);

      const moveD = speed * dt;
      this.pos.x -= Math.sin(this.heading) * moveD;
      this.pos.z -= Math.cos(this.heading) * moveD;
      this.level.collide(this.pos, 0.38);
    } else if (speed > 0 && this.path.length > 0 && !this.frozen) {
      const wp = this.path[0];
      const wx = this.level.worldX(wp.x);
      const wz = this.level.worldZ(wp.z);
      const dx = wx - this.pos.x;
      const dz = wz - this.pos.z;
      const d = Math.hypot(dx, dz);

      if (d < 0.6) {
        this.path.shift();
      } else {
        const targetHeading = Math.atan2(-dx, -dz);
        let diff = targetHeading - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turnRate = this.state === "chase" ? 9 : 5;
        this.heading += diff * Math.min(1, dt * turnRate);

        const moveD = Math.min(d, speed * dt);
        this.pos.x -= Math.sin(this.heading) * moveD;
        this.pos.z -= Math.cos(this.heading) * moveD;
        this.level.collide(this.pos, 0.38);
      }
    } else if (speed === 0 && los && !this.frozen) {
      // Even if stopped (to keep distance), turn body to face the player
      const dx = ctx.playerPos.x - this.pos.x;
      const dz = ctx.playerPos.z - this.pos.z;
      const targetHeading = Math.atan2(-dx, -dz);
      let diff = targetHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 5);
    }

    // ----- KILL -----
    if (dist < 1.3 && !this.frozen) {
      this.onKill?.();
    }

    // ----- AUDIO -----
    if (this.state === "chase" && !this.frozen) {
      this.screechTimer -= dt;
      if (this.screechTimer <= 0) {
        this.onScreech?.();
        this.screechTimer = randRange(this.rng, 4, 10);
      }
    }

    this.animate(dt, ctx, speed, dist);
  }

  /* ------------------------------------------------------------------ */
  /*  A* pathfinding (mirrors Entity)                                    */
  /* ------------------------------------------------------------------ */

  private computePath(playerPos: THREE.Vector3) {
    const from = this.level.cellOf(this.pos.x, this.pos.z);
    let target: { x: number; z: number };

    if (this.state === "chase" || this.state === "stalk") {
      target = this.level.cellOf(playerPos.x, playerPos.z);
    } else {
      if (!this.waypoint || (from.x === this.waypoint.x && from.z === this.waypoint.z)) {
        this.waypoint = this.level.randomOpenCell(this.rng, 8);
      }
      target = this.waypoint;
    }

    const path = this.aStar(from, target);
    if (path) this.path = path;
  }

  private aStar(
    from: { x: number; z: number },
    to: { x: number; z: number },
  ): { x: number; z: number }[] | null {
    if (this.level.isBlocked(to.x, to.z)) return null;
    const S = this.level.size;
    const key = (x: number, z: number) => z * S + x;
    const open = new Map<number, number>();
    const g = new Map<number, number>();
    const came = new Map<number, number>();
    const startK = key(from.x, from.z);
    const goalK = key(to.x, to.z);
    g.set(startK, 0);
    open.set(startK, Math.abs(to.x - from.x) + Math.abs(to.z - from.z));

    let iterations = 0;
    while (open.size > 0 && iterations++ < 2500) {
      let curK = -1,
        curF = Infinity;
      for (const [k, f] of open) {
        if (f < curF) {
          curF = f;
          curK = k;
        }
      }
      if (curK === goalK) {
        const cells: { x: number; z: number }[] = [];
        let k = curK;
        while (k !== startK) {
          cells.push({ x: k % S, z: Math.floor(k / S) });
          k = came.get(k)!;
        }
        cells.reverse();
        return this.smoothPath(cells);
      }
      open.delete(curK);
      const cx = curK % S,
        cz = Math.floor(curK / S);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!this.level.canMove(cx, cz, dx, dz)) continue;
        const nx = cx + dx,
          nz = cz + dz;
        const nk = key(nx, nz);
        const ng = g.get(curK)! + 1;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          came.set(nk, curK);
          open.set(nk, ng + Math.abs(to.x - nx) + Math.abs(to.z - nz));
        }
      }
    }
    return null;
  }

  private smoothPath(
    cells: { x: number; z: number }[],
  ): { x: number; z: number }[] {
    if (cells.length <= 2) return cells;
    const out: { x: number; z: number }[] = [];
    let anchor = this.level.cellOf(this.pos.x, this.pos.z);
    let i = 0;
    while (i < cells.length) {
      let j = Math.min(i + 6, cells.length - 1);
      while (
        j > i &&
        !this.level.lineOfSight(anchor.x, anchor.z, cells[j].x, cells[j].z)
      ) {
        j--;
      }
      out.push(cells[j]);
      anchor = cells[j];
      i = j + 1;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  procedural animation — no rigging needed                           */
  /* ------------------------------------------------------------------ */

  private animate(
    dt: number,
    ctx: EntityContext,
    speed: number,
    dist: number,
  ) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;

    if (!this.modelRoot) return;

    // Head tracking - aim at player's head
    if (this.bHead) {
      // Reset to initial
      this.bHead.quaternion.copy(this.initQuats.get(this.bHead)!);

      const dx = ctx.playerHead.x - this.pos.x;
      const dz = ctx.playerHead.z - this.pos.z;
      const dy = ctx.playerHead.y - (this.pos.y + 1.8);
      
      const targetHeading = Math.atan2(-dx, -dz);
      let yawDiff = targetHeading - this.heading;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      
      const dist2D = Math.hypot(dx, dz);
      const pitchDiff = Math.atan2(dy, dist2D);

      const clampedYaw = Math.max(-1.0, Math.min(1.0, yawDiff));
      const clampedPitch = Math.max(-0.8, Math.min(0.8, pitchDiff));

      // Try rotating around local X (pitch) and local Y (yaw)
      // Usually, Y is up/down axis (turning head left/right) and X is left/right axis (nodding up/down)
      this.bHead.rotateX(clampedPitch);
      this.bHead.rotateY(clampedYaw); 
    }

    // Walk cycle
    if (speed > 0.01) {
      const prevCycle = Math.floor(this.walkPhase / Math.PI);
      this.walkPhase += dt * (2.1 + speed * 1.9);
      if (Math.floor(this.walkPhase / Math.PI) !== prevCycle) this.onStep?.();
    } else {
      this.walkPhase += (Math.round(this.walkPhase / (Math.PI * 2)) * Math.PI * 2 - this.walkPhase) * dt * 5;
    }

    const time = ctx.time + this.timeOffset;
    
    const stride = Math.sin(this.walkPhase);
    const strideAbs = Math.abs(stride);
    
    // Reset bones to initial pose before applying relative rotation
    if (this.bLegL) this.bLegL.quaternion.copy(this.initQuats.get(this.bLegL)!);
    if (this.bLegR) this.bLegR.quaternion.copy(this.initQuats.get(this.bLegR)!);
    if (this.bKneeL) this.bKneeL.quaternion.copy(this.initQuats.get(this.bKneeL)!);
    if (this.bKneeR) this.bKneeR.quaternion.copy(this.initQuats.get(this.bKneeR)!);
    if (this.bArmL) this.bArmL.quaternion.copy(this.initQuats.get(this.bArmL)!);
    if (this.bArmR) this.bArmR.quaternion.copy(this.initQuats.get(this.bArmR)!);
    if (this.bSpine) this.bSpine.quaternion.copy(this.initQuats.get(this.bSpine)!);

    // Legs swing forward/backward (Pitch, usually local X)
    if (this.bLegL && this.bLegR) {
      this.bLegL.rotateX(stride * 0.8);
      this.bLegR.rotateX(-stride * 0.8);
    }
    
    if (this.bKneeL && this.bKneeR) {
      this.bKneeL.rotateX(Math.max(0, stride) * 1.2);
      this.bKneeR.rotateX(Math.max(0, -stride) * 1.2);
    }

    // Arms swing forward/backward (Pitch is usually local X if rotateZ flapped them)
    if (this.bArmL && this.bArmR) {
      this.bArmL.rotateX(stride * 0.6);
      this.bArmR.rotateX(-stride * 0.6);
    }

    // Spine swaying while walking
    if (this.bSpine) {
      this.bSpine.rotateY(Math.sin(this.walkPhase * 0.5) * 0.1 * (speed > 0 ? 1 : 0));
    }

    // Creepy bobbing
    const bobAmp = this.frozen ? 0 : speed > 0 ? 0.05 : 0.01;
    this.modelRoot.position.y = -strideAbs * bobAmp;

    // Violent twitch — sudden jerk of the whole body
    this.twitchTimer -= dt;
    if (this.twitchTimer <= 0) {
      this.twitchTimer = this.frozen
        ? randRange(this.rng, 1.5, 4)
        : randRange(this.rng, 0.5, 2.5);
      this.twitchT = 1;
      this.twitchVec.set(
        (this.rng() - 0.5) * 0.8,
        (this.rng() - 0.5) * 1.0,
        (this.rng() - 0.5) * 0.5,
      );
    }
    
    if (this.twitchT > 0 && this.bHead && this.bSpine) {
      this.twitchT = Math.max(0, this.twitchT - dt * 8);
      const t = this.twitchT;
      this.bHead.rotation.x += this.twitchVec.x * t;
      this.bHead.rotation.y += this.twitchVec.y * t;
      this.bSpine.rotation.z += this.twitchVec.z * t;
    }

    // Glowing eyes and smile in the dark based on distance!
    if (this.glowMats.length > 0) {
      const danger = Math.max(0, Math.min(1, 1 - (dist - 3) / 19));
      let targetIntensity = 0;
      let r = 0.8, g = 0.1, b = 0.0; // Deep sinister red

      if (this.state === "chase" && danger > 0.1) {
        // Pulses rapidly based on speed and danger
        const pulse = 0.5 + 0.5 * Math.sin(time * (10 + danger * 15));
        targetIntensity = (0.2 + 1.8 * danger * pulse) * (this.frozen ? 0.2 : 1.0);
        
        // As it gets extremely close, it shifts to bright orange/yellow (deadlights)
        g = 0.1 + 0.4 * Math.pow(danger, 3);
      } else if (this.state === "stalk") {
        targetIntensity = 0.4; // Faint glow watching you
      }

      for (const mat of this.glowMats) {
        if (!mat.emissive) mat.emissive = new THREE.Color(0x000000);
        mat.emissive.setRGB(r, g, b);
        mat.emissiveIntensity += (targetIntensity - mat.emissiveIntensity) * Math.min(1, dt * 5);
      }
    }
  }
}
