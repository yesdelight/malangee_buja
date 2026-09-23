import * as THREE from 'three';
import { haptic, sound } from './feel.js';

const SEGMENTS = 48;
export class SquishyScene {
  constructor(canvas, { onSelect = () => {}, onChange = () => {} } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onChange = onChange;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#ffffff');
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    this.camera.position.set(0, 0, 16);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdeddd6, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(-4, 6, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdbe9ff, 0.7);
    fill.position.set(5, -3, 4);
    this.scene.add(fill);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.items = [];
    this.selected = null;
    this.interaction = null;
    this.lastFrame = performance.now();
    this.lastSave = 0;
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    this.onResize = this.resize.bind(this);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
    this.resize();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const aspect = width / height;
    const halfHeight = 4.65;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  async add({ id, blob, name, x, y, preset }) {
    const bitmap = await createImageBitmap(blob);
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = 128;
    alphaCanvas.height = 128;
    const alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true });
    alphaContext.drawImage(bitmap, 0, 0, alphaCanvas.width, alphaCanvas.height);
    const alphaPixels = alphaContext.getImageData(0, 0, alphaCanvas.width, alphaCanvas.height).data;
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    const aspect = bitmap.width / bitmap.height;
    const height = Math.min(2.55, Math.max(1.15, 2.15 / Math.max(1, aspect)));
    const width = height * aspect;
    const geometry = new THREE.PlaneGeometry(width, height, SEGMENTS, SEGMENTS);
    const position = geometry.getAttribute('position');
    const basePositions = new Float32Array(position.array.length);
    for (let index = 0; index < position.count; index++) {
      const px = position.getX(index) / (width / 2);
      const py = position.getY(index) / (height / 2);
      const dome = Math.max(0, 1 - px * px - py * py);
      position.setZ(index, Math.pow(dome, 1.1) * 0.27);
    }
    basePositions.set(position.array);
    geometry.computeVertexNormals();
    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.035,
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.toyId = id;
    const group = new THREE.Group();
    group.position.set(x, y, 0);
    group.add(mesh);
    const shadow = this.makeShadow(width, height);
    group.add(shadow);
    this.scene.add(group);
    const item = {
      id, name, blob, group, mesh, geometry, texture, basePositions, alphaPixels,
      width, height, velocity: new THREE.Vector2(), press: 0, pressTarget: 0,
      contact: new THREE.Vector2(), hasContact: false, preset: preset || 'soft',
      scaleX: 1, scaleY: 1, targetScaleX: 1, targetScaleY: 1, spin: 0,
      resting: false, lastCollision: 0,
    };
    this.items.push(item);
    return item;
  }

  makeShadow(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 32, 3, 64, 32, 62);
    gradient.addColorStop(0, 'rgba(25,22,18,.22)');
    gradient.addColorStop(1, 'rgba(25,22,18,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 64);
    const texture = new THREE.CanvasTexture(canvas);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.9, height * 0.3),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.9 }),
    );
    shadow.position.set(0.04, -height * 0.47, -0.06);
    shadow.renderOrder = -1;
    return shadow;
  }

  select(item) {
    this.selected = item;
    this.onSelect(item);
  }

  getItemFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.items.map((item) => item.mesh), false);
    return hits.find((hit) => {
      if (!hit.uv) return true;
      const item = this.items.find((candidate) => candidate.mesh === hit.object);
      if (!item) return false;
      const x = THREE.MathUtils.clamp(Math.floor(hit.uv.x * 128), 0, 127);
      const y = THREE.MathUtils.clamp(Math.floor((1 - hit.uv.y) * 128), 0, 127);
      return item.alphaPixels[(y * 128 + x) * 4 + 3] > 18;
    }) || null;
  }

  eventToWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const origin = new THREE.Vector3(x, y, 0.5).unproject(this.camera);
    const direction = new THREE.Vector3(0, 0, -1);
    const distance = -origin.z / direction.z;
    return origin.addScaledVector(direction, distance);
  }

  handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const previous = this.interaction;
    if (previous) {
      const item = this.selected;
      if (!item) return;
      previous.pointers ??= new Map([[previous.pointerId, previous.lastClient]]);
      previous.pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      if (previous.pointers.size >= 2) {
        const [a, b] = [...previous.pointers.values()];
        previous.mode = 'pinch';
        previous.pinchDistance = Math.max(1, a.distanceTo(b));
        previous.baseScaleX = item.group.scale.x;
        previous.baseScaleY = item.group.scale.y;
        item.pressTarget = 0.25;
        this.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
    const hit = this.getItemFromEvent(event);
    if (!hit) {
      this.select(null);
      return;
    }
    const item = this.items.find((candidate) => candidate.mesh === hit.object);
    if (!item) return;
    this.select(item);
    const world = this.eventToWorld(event);
    const uv = hit.uv || new THREE.Vector2(0.5, 0.5);
    item.contact.set((uv.x - 0.5) * item.width, (uv.y - 0.5) * item.height);
    item.hasContact = true;
    item.pressTarget = 1;
    item.velocity.set(0, 0);
    item.resting = false;
    const now = performance.now();
    this.interaction = {
      mode: 'drag', pointerId: event.pointerId, item,
      pointerOffset: new THREE.Vector2(item.group.position.x - world.x, item.group.position.y - world.y),
      lastWorld: world.clone(), lastTime: now, lastClient: new THREE.Vector2(event.clientX, event.clientY),
      pointers: new Map([[event.pointerId, new THREE.Vector2(event.clientX, event.clientY)]]),
    };
    this.canvas.setPointerCapture(event.pointerId);
    sound('press', 0.55);
    haptic(0.42);
    event.preventDefault();
  }

  handlePointerMove(event) {
    const interaction = this.interaction;
    if (!interaction) return;
    const { item } = interaction;
    if (interaction.mode === 'pinch') {
      if (!interaction.pointers.has(event.pointerId)) return;
      interaction.pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      const [a, b] = [...interaction.pointers.values()];
      const scale = THREE.MathUtils.clamp(a.distanceTo(b) / interaction.pinchDistance, 0.62, 1.6);
      item.group.scale.x = interaction.baseScaleX * scale;
      item.group.scale.y = interaction.baseScaleY * scale;
      item.targetScaleX = 1;
      item.targetScaleY = 1;
      item.pressTarget = 0.45;
      event.preventDefault();
      return;
    }
    if (event.pointerId !== interaction.pointerId) return;
    const world = this.eventToWorld(event);
    const now = performance.now();
    const dt = Math.max(0.008, (now - interaction.lastTime) / 1000);
    item.group.position.set(world.x + interaction.pointerOffset.x, world.y + interaction.pointerOffset.y, 0);
    item.resting = false;
    item.velocity.set((world.x - interaction.lastWorld.x) / dt, (world.y - interaction.lastWorld.y) / dt);
    interaction.lastWorld.copy(world);
    interaction.lastClient.set(event.clientX, event.clientY);
    interaction.lastTime = now;
    const hit = this.getItemFromEvent(event);
    if (hit?.object === item.mesh && hit.uv) item.contact.set((hit.uv.x - 0.5) * item.width, (hit.uv.y - 0.5) * item.height);
    event.preventDefault();
  }

  handlePointerUp(event) {
    const interaction = this.interaction;
    if (!interaction) return;
    if (interaction.mode === 'pinch') {
      interaction.pointers.delete(event.pointerId);
      if (interaction.pointers.size > 0) {
        interaction.mode = 'drag';
        const [pointerId, client] = interaction.pointers.entries().next().value;
        interaction.pointerId = pointerId;
        interaction.lastClient.copy(client);
        interaction.lastWorld = this.eventToWorld({ clientX: client.x, clientY: client.y });
        const item = interaction.item;
        interaction.pointerOffset.set(item.group.position.x - interaction.lastWorld.x, item.group.position.y - interaction.lastWorld.y);
        interaction.lastTime = performance.now();
      } else {
        interaction.item.pressTarget = 0;
        this.interaction = null;
      }
      sound('release', 0.56);
      haptic(0.58);
      return;
    }
    if (event.pointerId !== interaction.pointerId) return;
    const item = interaction.item;
    item.pressTarget = 0;
    item.hasContact = false;
    if (item.velocity.length() > 1.25) {
      item.velocity.multiplyScalar(0.48);
      sound('release', Math.min(1, item.velocity.length() / 8));
      haptic(0.78);
    } else {
      item.velocity.multiplyScalar(0.08);
      sound('release', 0.4);
      haptic(0.56);
    }
    item.targetScaleX = 1;
    item.targetScaleY = 1;
    item.resting = false;
    this.interaction = null;
    this.onChange(item);
  }

  stretch(item = this.selected) {
    if (!item) return;
    item.group.scale.x = 1.22;
    item.group.scale.y = 0.86;
    item.targetScaleX = 1;
    item.targetScaleY = 1;
    item.press = 0.3;
    item.resting = false;
    sound('stretch', 0.85);
    haptic(0.72);
    setTimeout(() => { item.press = 0; }, 180);
  }

  bounce(item = this.selected) {
    if (!item) return;
    item.velocity.set((Math.random() - 0.5) * 4, 6.2);
    item.resting = false;
    item.pressTarget = 0;
    sound('hit', 0.8);
    haptic(0.82);
  }

  setPreset(item, preset) {
    if (!item) return;
    item.preset = preset;
    item.press = 0.65;
    sound('press', 0.52);
    haptic(0.44);
    setTimeout(() => { item.press = 0; }, 170);
    this.onChange(item);
  }

  remove(item = this.selected) {
    if (!item) return;
    this.scene.remove(item.group);
    item.geometry.dispose();
    item.mesh.material.map?.dispose();
    item.mesh.material.dispose();
    item.group.children.find((child) => child !== item.mesh)?.material.map?.dispose();
    item.group.children.find((child) => child !== item.mesh)?.geometry.dispose();
    item.group.children.find((child) => child !== item.mesh)?.material.dispose();
    this.items = this.items.filter((candidate) => candidate !== item);
    if (this.selected === item) this.select(null);
  }

  frame(time) {
    const dt = Math.min(0.04, Math.max(0.001, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    const aspect = this.camera.right / 4.65;
    const left = this.camera.left + 0.8;
    const right = this.camera.right - 0.8;
    const bottom = this.camera.bottom + 0.75;
    const top = this.camera.top - 0.7;
    for (const item of this.items) {
      if (this.interaction?.item !== item) {
        if (!item.resting) {
          item.velocity.y -= 2.1 * dt;
          item.group.position.x += item.velocity.x * dt;
          item.group.position.y += item.velocity.y * dt;
          item.velocity.multiplyScalar(Math.exp(-0.66 * dt));
        }
      }
      const halfW = item.width * item.group.scale.x * 0.46;
      const halfH = item.height * item.group.scale.y * 0.46;
      if (item.group.position.x < left + halfW) {
        item.group.position.x = left + halfW;
        item.velocity.x = Math.abs(item.velocity.x) * itemPreset(item.preset).bounce;
        this.collide(item, time);
      } else if (item.group.position.x > right - halfW) {
        item.group.position.x = right - halfW;
        item.velocity.x = -Math.abs(item.velocity.x) * itemPreset(item.preset).bounce;
        this.collide(item, time);
      }
      if (item.group.position.y < bottom + halfH) {
        item.group.position.y = bottom + halfH;
        if (Math.abs(item.velocity.y) > 0.72) {
          this.collide(item, time);
          item.velocity.y = Math.abs(item.velocity.y) * itemPreset(item.preset).bounce * 0.55;
        } else {
          item.velocity.y = 0;
          item.resting = true;
        }
      } else if (item.group.position.y > top - halfH) {
        item.group.position.y = top - halfH;
        item.velocity.y = -Math.abs(item.velocity.y) * itemPreset(item.preset).bounce * 0.55;
        this.collide(item, time);
      }
      item.group.rotation.z += (THREE.MathUtils.clamp(item.velocity.x * -0.025, -0.22, 0.22) - item.group.rotation.z) * Math.min(1, dt * 2.3);
      const preset = itemPreset(item.preset);
      item.press = THREE.MathUtils.damp(item.press, item.pressTarget, preset.restore * 10, dt);
      const scaleSpring = preset.restore * 7;
      item.group.scale.x = THREE.MathUtils.damp(item.group.scale.x, item.targetScaleX, scaleSpring, dt);
      item.group.scale.y = THREE.MathUtils.damp(item.group.scale.y, item.targetScaleY, scaleSpring, dt);
      this.updateDeformation(item, preset, dt);
    }
    this.collidePairs(time);
    if (time - this.lastSave > 1200) {
      this.lastSave = time;
      for (const item of this.items) this.onChange(item, true);
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  }

  updateDeformation(item, preset, dt) {
    const attribute = item.geometry.getAttribute('position');
    const positions = attribute.array;
    const pressure = Math.max(item.press, item.pressTarget * 0.92);
    const radius = Math.max(item.width, item.height) * (item.preset === 'stretchy' ? 0.24 : 0.2);
    let changed = false;
    for (let index = 0; index < attribute.count; index++) {
      const base = index * 3;
      const x = item.basePositions[base];
      const y = item.basePositions[base + 1];
      const dx = x - item.contact.x;
      const dy = y - item.contact.y;
      const weight = item.hasContact ? Math.exp(-(dx * dx + dy * dy) / (radius * radius)) : 0;
      const pressedZ = item.basePositions[base + 2] - weight * pressure * preset.squash;
      const bounce = item.press ? item.press * 0.035 * Math.sin((index + 1) * 2.1) : 0;
      const targetZ = pressedZ + bounce;
      const nextZ = THREE.MathUtils.damp(positions[base + 2], targetZ, item.pressTarget ? 18 : 12, dt);
      if (Math.abs(positions[base + 2] - nextZ) > 0.0003) changed = true;
      positions[base + 2] = nextZ;
    }
    if (changed) {
      attribute.needsUpdate = true;
      item.geometry.computeVertexNormals();
    }
  }

  collide(item, time) {
    if (time - item.lastCollision < 260) return;
    item.lastCollision = time;
    item.press = Math.max(item.press, 0.8);
    sound('hit', Math.min(1, item.velocity.length() / 6));
    haptic(Math.min(1, item.velocity.length() / 5));
  }

  collidePairs(time) {
    for (let a = 0; a < this.items.length; a++) {
      for (let b = a + 1; b < this.items.length; b++) {
        const first = this.items[a];
        const second = this.items[b];
        const dx = second.group.position.x - first.group.position.x;
        const dy = second.group.position.y - first.group.position.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const radius = (Math.min(first.width, first.height) + Math.min(second.width, second.height)) * 0.22;
        if (distance >= radius) continue;
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = radius - distance;
        first.group.position.x -= nx * overlap * 0.5;
        first.group.position.y -= ny * overlap * 0.5;
        second.group.position.x += nx * overlap * 0.5;
        second.group.position.y += ny * overlap * 0.5;
        const relative = (second.velocity.x - first.velocity.x) * nx + (second.velocity.y - first.velocity.y) * ny;
      if (relative < -0.35) {
          const impulse = -(1 + 0.64) * relative / 2;
          first.velocity.x -= impulse * nx;
          first.velocity.y -= impulse * ny;
          second.velocity.x += impulse * nx;
          second.velocity.y += impulse * ny;
          first.resting = false;
          second.resting = false;
          if (Math.abs(relative) > 2.8) {
            this.collide(first, time);
            this.collide(second, time);
          }
        }
      }
    }
  }
}

function itemPreset(id) {
  const values = {
    soft: { squash: 0.34, restore: 0.18, bounce: 0.75 },
    stretchy: { squash: 0.56, restore: 0.09, bounce: 0.48 },
    bouncy: { squash: 0.19, restore: 0.24, bounce: 1.08 },
    fluffy: { squash: 0.42, restore: 0.13, bounce: 0.63 },
    saggy: { squash: 0.5, restore: 0.065, bounce: 0.34 },
  };
  return values[id] || values.soft;
}
