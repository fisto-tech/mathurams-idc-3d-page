import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/OBJLoader.js';
import { GLTFExporter } from 'https://unpkg.com/three@0.128.0/examples/jsm/exporters/GLTFExporter.js';
import { RGBELoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/RGBELoader.js';

// == Scene ====================================================================
const canvas  = document.getElementById('three-canvas');
const wrap    = document.getElementById('canvas-wrap');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.outputEncoding    = THREE.sRGBEncoding;
// LinearToneMapping keeps material colors accurate (matches Three.js editor default)
renderer.toneMapping       = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xF8FAFC);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(5, 4, 7);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance   = 0.1;
controls.maxDistance   = 5000;
controls.autoRotate    = true;
controls.autoRotateSpeed = 1.0;

// == Lights ===================================================================
// Ambient: fills shadows naturally without color tinting (matches Three.js editor)
const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

// Main key light - casts shadows, positioned upper-front-right like Three.js editor default
const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
dirLight.position.set(5, 10, 7.5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.1;
dirLight.shadow.camera.far  = 500;
scene.add(dirLight);

// Fill light from opposite side - softens harsh shadows without washing out colors
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
fillLight.position.set(-5, 5, -5);
scene.add(fillLight);

// Keep scene reference for camera add (needed by OrbitControls)
scene.add(camera);

// == Environment Map =========================================================
// For standard models: no env map - materials show true PBR colors (matches Three.js editor)
// For couch: load HDR studio env for better reflections on upholstered surfaces
let hdrEnvMap = null;
scene.environment = null;

function updateEnvironment(isCouch) {
  if (isCouch) {
    // Dim direct lights when HDR env is driving illumination
    ambientLight.intensity = 0.6;
    dirLight.intensity = 0.8;
    fillLight.intensity = 0.3;
    
    if (hdrEnvMap) {
      scene.environment = hdrEnvMap;
    } else {
      const rgbeLoader = new RGBELoader();
      rgbeLoader.setDataType(THREE.UnsignedByteType);
      rgbeLoader.load('assets/models/brown_photostudio_02_2k.hdr', (texture) => {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();
        hdrEnvMap = pmremGenerator.fromEquirectangular(texture).texture;
        pmremGenerator.dispose();
        texture.dispose();
        
        const currentIsCouch = currentModelName.toLowerCase().includes('couch') || currentModelName.toLowerCase().includes('examination') || productName === 'Deluxe Examination Couch';
        if (currentIsCouch) {
          scene.environment = hdrEnvMap;
        }
      }, undefined, (err) => {
        console.error('Error loading HDR environment map:', err);
      });
    }
  } else {
    // No env map for standard models - direct lights accurately reproduce material colors
    ambientLight.intensity = 1.0;
    dirLight.intensity = 2.0;
    fillLight.intensity = 0.5;
    scene.environment = null;
  }
}

// == Solid Floor ==============================================================
const floorGeo = new THREE.PlaneGeometry(1000, 1000);
const floorMat = new THREE.ShadowMaterial({
  opacity: 0.45   // Crisper shadows matching Three.js editor
});
const floorPlane = new THREE.Mesh(floorGeo, floorMat);
floorPlane.rotation.x = -Math.PI / 2;
floorPlane.receiveShadow = true;
scene.add(floorPlane);

// == Axes =====================================================================
const axesHelper = new THREE.AxesHelper(1);
// scene.add(axesHelper);

// == State ====================================================================
let userColorsChanged = {
  frame: false,
  mattress: false,
  absPanel: false,
  absRail: false,
  cabinet: false,
  drawer: false
};
let currentModel    = null;
let currentModelName = '';
let isCurrentModelViewOnly = false;
let meshMap         = {};        // key → { mesh, visible, name, triCount }
let defaultCamPos   = null;
let defaultCamTarget = null;
let wireframeMode   = false;
let bgIndex         = 0;
const bgColors      = [0xc7c7c7, 0xFFFFFF, 0xF8FAFC, 0xE2E8F0, 0xF1F5F9];
let selectedMesh    = null;      // key or null
let loadGeneration  = 0;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// == Resize ===================================================================
function resize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

// == Render loop ==============================================================
(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

// == DOM refs =================================================================
const loadingEl   = document.getElementById('loading');
const loadingName = document.getElementById('loading-name');
const initialHint = document.getElementById('initial-hint');
const emptyState  = document.getElementById('empty-state');
const meshListEl  = document.getElementById('mesh-list');
const fileLabel   = document.getElementById('file-label');
const infoBadge   = document.getElementById('info-badge');
const fbxLoader  = new FBXLoader();
const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.128.0/examples/js/libs/draco/');
gltfLoader.setDRACOLoader(dracoLoader);
const objLoader  = new OBJLoader();

// == Load Model ===============================================================
function loadModel(fileOrUrl, fileName) {
  const myGen = ++loadGeneration;
  const isUrl = typeof fileOrUrl === 'string';
  const url = isUrl ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  const name = isUrl ? (fileName || fileOrUrl.split('/').pop()) : fileOrUrl.name;
  currentModelName = name;

  // Dynamically update product name based on loaded model
  const lowerName = name.toLowerCase();
  if (lowerName.includes('icu')) {
    productName = 'ICU Cot';
  } else if (lowerName.includes('deluxe-double-door') || lowerName.includes('deluxe_double_door')) {
    productName = 'Deluxe Double Door Attender Cot';
  } else if (lowerName.includes('attender_cot_deluxe') || lowerName.includes('attender-cot-deluxe')) {
    productName = 'Attender Cot Deluxe';
  } else if (lowerName.includes('attender_cot_plain') || lowerName.includes('attender-cot-plain')) {
    productName = 'Attender Cot Plain';
  } else if (lowerName.includes('sidelocker_deluxe') || lowerName.includes('sidelocker-deluxe')) {
    productName = 'Bed Sidelocker Deluxe Wood';
  } else if (lowerName.includes('locker_plain') || lowerName.includes('locker-plain')) {
    productName = 'Bedside Locker Plain';
  } else if (lowerName.includes('semi_fowler') || lowerName.includes('semi-fowler')) {
    productName = 'Semi Fowler Cot';
  } else if (lowerName.includes('hi-lo') || lowerName.includes('hi_lo') || lowerName.includes('hilo')) {
    productName = 'Hi-Lo Structure';
  } else if (lowerName.includes('couch') || lowerName.includes('examination')) {
    productName = 'Deluxe Examination Couch';
  }

  const titleEl = document.getElementById('product-title');
  if (titleEl) {
    titleEl.textContent = productName;
  }

  loadingName.textContent = name;
  loadingEl.classList.add('visible');
  if (initialHint) initialHint.style.display = 'none';

  // Classify model type (View-only vs Customisation)
  const isViewOnly = url.toLowerCase().includes('view-only-models') ||
                     name.toLowerCase().includes('over-bed-table') ||
                     name.toLowerCase().includes('semi-fowler-cot') ||
                     name.toLowerCase().includes('attender-cot') ||
                     name.toLowerCase().includes('bedside-locker');

  const appEl = document.getElementById('app');
  if (appEl) {
    if (isViewOnly) {
      appEl.classList.add('view-only');
      const inspectorSidebar = document.getElementById('sidebar');
      const inspectorToggleBtn = document.getElementById('inspector-toggle-btn');
      if (inspectorSidebar) inspectorSidebar.classList.remove('open');
      if (inspectorToggleBtn) inspectorToggleBtn.classList.remove('active');
    } else {
      appEl.classList.remove('view-only');
    }
    // Recalculate canvas aspect ratio and size immediately
    setTimeout(resize, 0);
  }

  isCurrentModelViewOnly = isViewOnly;

  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }
  meshMap       = {};
  selectedMesh  = null;
  userColorsChanged = {
    frame: false,
    mattress: false,
    absPanel: false,
    absRail: false,
    cabinet: false,
    drawer: false
  };

  const ext = name.split('.').pop().toLowerCase();
  let activeLoader = null;

  if (ext === 'fbx') {
    activeLoader = fbxLoader;
  } else if (ext === 'glb' || ext === 'gltf') {
    activeLoader = gltfLoader;
  } else if (ext === 'obj') {
    activeLoader = objLoader;
  } else {
    if (!isUrl) URL.revokeObjectURL(url);
    loadingEl.classList.remove('visible');
    showToast('Unsupported format');
    return;
  }

  activeLoader.load(url, (loadedObj) => {
    if (!isUrl) URL.revokeObjectURL(url);

    if (myGen !== loadGeneration) return;

    loadingEl.classList.remove('visible');

    let modelGroup = loadedObj;
    if (ext === 'glb' || ext === 'gltf') {
      modelGroup = loadedObj.scene;
    }

    currentModel = modelGroup;

    // Keep original scale/measurements (do not normalise scale)
    const scale  = 1;
    modelGroup.scale.setScalar(scale);

    // Centre on ground plane
    const box    = new THREE.Box3().setFromObject(modelGroup);
    const centre = box.getCenter(new THREE.Vector3());
    modelGroup.position.sub(centre);
    box.setFromObject(modelGroup);
    modelGroup.position.y -= box.min.y;

     // Collect meshes + shadows
     let totalTris = 0;
     modelGroup.traverse((child) => {
       if (!child.isMesh) return;
       child.castShadow    = true;
       child.receiveShadow = true;
       // Fix the incorrect metalness/roughness in the GLB for the ABS plastic railings
       if (child.material) {
         const materials = Array.isArray(child.material) ? child.material : [child.material];
         materials.forEach(mat => {
           if (false && mat.name && mat.name.toLowerCase() === 'abs_siderail') {
             mat.metalness = 0.0;
             mat.roughness = 0.45;
             mat.needsUpdate = true;
           }
         });
       }

      let triCount = 0;
      if (child.geometry) {
        const geo = child.geometry;
        if (!geo.attributes.normal) geo.computeVertexNormals();
        triCount = geo.index
          ? geo.index.count / 3
          : (geo.attributes.position?.count ?? 0) / 3;
        totalTris += triCount;
      }

      const parentName = (child.parent && child.parent.name && child.parent.name !== 'Scene' && child.parent.name !== 'RootNode') ? child.parent.name : '';
      const rawName = parentName || child.name || `Mesh`;
      const key     = rawName;
      
      if (meshMap[key]) {
        meshMap[key].meshes.push(child);
        meshMap[key].triCount += triCount;
      } else {
        meshMap[key] = { meshes: [child], visible: true, name: rawName, triCount };
      }
    });

    scene.add(modelGroup);

    const box2      = new THREE.Box3().setFromObject(modelGroup);
    const sz2       = box2.getSize(new THREE.Vector3());
    let maxSz       = Math.max(sz2.x, sz2.y, sz2.z);
    if (!maxSz || isNaN(maxSz) || maxSz === 0) maxSz = 1;

    const footprint = Math.max(sz2.x, sz2.z, 1);
    const d = footprint * 1.5;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.camera.updateProjectionMatrix();

    // Fit camera safely
    const fov    = camera.fov * (Math.PI / 180);
    let dist     = (maxSz / 2) / Math.tan(fov / 2) * 1.8;
    if (!dist || isNaN(dist) || dist < 0.1) dist = 2.0;
    
    const target = box2.getCenter(new THREE.Vector3());
    if (isNaN(target.x) || isNaN(target.y) || isNaN(target.z)) {
      target.set(0, 0, 0);
    }
    
    camera.position.set(target.x + dist * 0.6, target.y + dist * 0.5, target.z + dist);
    controls.target.copy(target);

    // Limit zoom out distance to 100% of the initial view
    controls.maxDistance = camera.position.distanceTo(target) * 2; // Allow some extra zoom out room
    controls.update();

    console.log(`[Configurator] Loaded: ${name} | Size: ${maxSz.toFixed(2)} | Cam distance: ${dist.toFixed(2)} | Target: ${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)}`);

    defaultCamPos    = camera.position.clone();
    defaultCamTarget = target.clone();

    axesHelper.scale.setScalar(maxSz * 0.15);

    buildMeshList();
    updateStats();

    fileLabel.innerHTML = `Loaded: <span>${name}</span>`;
    infoBadge.classList.add('visible');
    document.getElementById('badge-name').textContent  = name;
    document.getElementById('badge-stats').textContent =
      `${Object.keys(meshMap).length} meshes . ${Math.round(totalTris).toLocaleString()} tris`;

    showToast(`Loaded "${name}"`);

    // Hide/show sections dynamically based on model type
    const isIcu = name.toLowerCase().includes('icu') || productName === 'ICU Cot';
    const isCouch = name.toLowerCase().includes('couch') || name.toLowerCase().includes('examination') || productName === 'Deluxe Examination Couch';
    
    updateEnvironment(isCouch);
    
    const sectionHeadFoot = document.getElementById('config-section-headfoot');
    const sectionSideRails = document.getElementById('config-section-siderails');
    const sectionMattress = document.getElementById('config-section-mattress');
    const sectionWheel = document.getElementById('config-section-wheel');
    const sectionOperation = document.getElementById('config-section-operation');

    if (isCouch) {
      if (sectionHeadFoot) sectionHeadFoot.style.display = 'none';
      if (sectionSideRails) sectionSideRails.style.display = 'none';
      if (sectionWheel) sectionWheel.style.display = 'none';
      if (sectionOperation) sectionOperation.style.display = 'none';
      
      const mattressRadioGroup = sectionMattress?.querySelector('.radio-group');
      if (mattressRadioGroup) mattressRadioGroup.style.display = 'none';
      const mattressTitle = sectionMattress?.querySelector('.config-section-title');
      if (mattressTitle) mattressTitle.style.display = 'none';
    } else {
      if (sectionHeadFoot) sectionHeadFoot.style.display = 'flex';
      if (sectionSideRails) sectionSideRails.style.display = 'flex';
      if (sectionWheel) sectionWheel.style.display = isIcu ? 'none' : 'flex';
      if (sectionOperation) sectionOperation.style.display = 'flex';
      
      const mattressRadioGroup = sectionMattress?.querySelector('.radio-group');
      if (mattressRadioGroup) mattressRadioGroup.style.display = 'flex';
      const mattressTitle = sectionMattress?.querySelector('.config-section-title');
      if (mattressTitle) mattressTitle.style.display = 'block';
    }

    // Automatically update heading serial letters (A, B, C, D, etc.) dynamically based on visibility
    updateSectionHeadings();

    // Set default configuration for the loaded model
    setDefaultConfigForModel(name);

    // Apply configuration immediately
    applyCurrentConfig();

  }, undefined, (err) => {
    if (!isUrl) URL.revokeObjectURL(url);
    if (myGen !== loadGeneration) return;
    loadingEl.classList.remove('visible');
    console.error('Model load error:', err);
    showToast('Failed to load model');
  });
}

function updateSectionHeadings() {
  const sections = [
    { id: 'config-section-headfoot', baseText: 'Head & Foot End Panel' },
    { id: 'config-section-siderails', baseText: 'Side Rails' },
    { id: 'config-section-mattress', baseText: 'Mattress Type' },
    { id: 'config-section-wheel', baseText: 'Wheel Type' },
    { id: 'config-section-operation', baseText: 'Operation' }
  ];

  let currentLetterCode = 65; // 'A'
  sections.forEach(sec => {
    const el = document.getElementById(sec.id);
    if (el && el.style.display !== 'none') {
      const titleEl = el.querySelector('.config-section-title');
      if (titleEl && titleEl.style.display !== 'none') {
        const letter = String.fromCharCode(currentLetterCode);
        titleEl.textContent = `${letter}. ${sec.baseText}`;
        currentLetterCode++;
      }
    }
  });
}

// Mesh name to WebP mapper helper
function getMeshIconSrc(name) {
  const lower = name.toLowerCase();
  if (lower.includes('abs')) return 'assets/images/abs-icon.webp';
  if (lower.includes('ss') && (lower.includes('collapsible') || lower.includes('colapsable'))) return 'assets/images/ss-collapsible-icon.webp';
  if (lower.includes('aluminium') || lower.includes('collapsible') || lower.includes('colapsable')) return 'assets/images/aluminium-collapsible-icon.webp';
  if (lower.includes('ms') || lower.includes('m1') || lower.includes('m4')) return 'assets/images/ms-icon.webp';
  if (lower.includes('ss') || lower.includes('plain')) return 'assets/images/ss-plain-icon.webp';
  return null;
}

// == Build mesh list UI ========================================================
function buildMeshList(filter = '') {
  meshListEl.querySelectorAll('.mesh-item').forEach(el => el.remove());

  const keys = Object.keys(meshMap);
  emptyState.style.display = keys.length === 0 ? 'flex' : 'none';

  const lf = filter.toLowerCase();
  keys.forEach((key, i) => {
    const entry = meshMap[key];
    if (lf && !entry.name.toLowerCase().includes(lf)) return;

    const hue  = (i * 47) % 360;
    const item = document.createElement('div');
    item.className  = 'mesh-item' + (selectedMesh === key ? ' active' : '') + (!entry.visible ? ' hidden-mesh' : '');
    item.dataset.key = key;

    const iconSrc = getMeshIconSrc(entry.name);
    const iconHtml = iconSrc 
      ? `<img src="${iconSrc}" alt="icon" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px;" />`
      : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        </svg>`;

    item.innerHTML = `
      <label class="toggle">
        <input type="checkbox" ${entry.visible ? 'checked' : ''} />
        <span class="toggle-track"></span>
      </label>
      <div class="mesh-icon" style="${iconSrc ? '' : `color:hsl(${hue},70%,55%)`}">
        ${iconHtml}
      </div>
      <span class="mesh-label" title="${entry.name}">${entry.name}</span>
      <button class="rename-btn" title="Rename mesh">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </button>
    `;

    const checkbox = item.querySelector('input');
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleMesh(key, checkbox.checked);
    });

    const renameBtn = item.querySelector('.rename-btn');
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const labelSpan = item.querySelector('.mesh-label');
      if (item.querySelector('.rename-input')) return;

      const currentName = entry.name;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'rename-input';
      input.value = currentName;

      labelSpan.replaceWith(input);
      input.focus();
      input.select();

      const finishRename = () => {
        const newName = input.value.trim() || currentName;
        entry.name = newName;
        entry.meshes.forEach(m => { m.name = newName; });

        const newLabelSpan = document.createElement('span');
        newLabelSpan.className = 'mesh-label';
        newLabelSpan.title = newName;
        newLabelSpan.textContent = newName;
        input.replaceWith(newLabelSpan);

        if (selectedMesh === key) {
          document.getElementById('badge-name').textContent = newName;
        }
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        } else if (e.key === 'Escape') {
          input.value = currentName;
          input.blur();
        }
      });

      input.addEventListener('blur', finishRename);
    });

    item.addEventListener('click', (e) => {
      if (e.target.closest('.toggle') || e.target.closest('.rename-btn') || e.target.closest('.rename-input')) return;
      focusMesh(key, item);
    });

    meshListEl.appendChild(item);
  });
}

// == Toggle one mesh ===========================================================
function toggleMesh(key, visible) {
  const entry      = meshMap[key];
  if (!entry) return;
  entry.visible    = visible;
  entry.meshes.forEach(mesh => {
    mesh.visible = visible;
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => { m.wireframe = visible ? wireframeMode : false; });
    }
  });

  const item = meshListEl.querySelector(`[data-key="${key}"]`);
  if (item) {
    item.classList.toggle('hidden-mesh', !visible);
    const cb = item.querySelector('input[type=checkbox]');
    if (cb) cb.checked = visible;
  }

  updateStats();
}

// == Focus camera on mesh =====================================================
function focusMesh(key, itemEl, forceSelect = false) {
  if (selectedMesh === key && !forceSelect) {
    selectedMesh = null;
    itemEl.classList.remove('active');
    return;
  }

  meshListEl.querySelectorAll('.mesh-item.active').forEach(el => el.classList.remove('active'));
  selectedMesh = key;
  itemEl.classList.add('active');

  const entry = meshMap[key];
  const box   = new THREE.Box3();
  entry.meshes.forEach(mesh => {
    box.expandByObject(mesh);
  });

  if (box.isEmpty()) return;

  const centre = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxSz  = Math.max(size.x, size.y, size.z);

  if (!isFinite(maxSz) || maxSz === 0) return;

  const fov  = camera.fov * (Math.PI / 180);
  const dist = (maxSz / 2) / Math.tan(fov / 2) * 2.5;

  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  if (dir.lengthSq() === 0) {
    dir.set(0.6, 0.4, 1).normalize();
  }

  controls.target.copy(centre);
  camera.position.copy(centre).addScaledVector(dir, dist);
  controls.update();
}

// == Stats ====================================================================
function updateStats() {
  const keys    = Object.keys(meshMap);
  const visible = keys.filter(k => meshMap[k].visible).length;
  document.getElementById('stat-meshes').textContent  = keys.length;
  document.getElementById('stat-visible').textContent = visible;

  const tris = keys.reduce((sum, k) => sum + (meshMap[k].triCount || 0), 0);
  document.getElementById('stat-tris').textContent = tris > 0 ? Math.round(tris).toLocaleString() : '-';
}

// == Set default configuration based on model ==================================
function setDefaultConfigForModel(name) {
  const lower = name.toLowerCase();
  
  // Define defaults per model
  let defaults = {
    headfoot: 'ms',
    siderails: 'ms',
    mattress: 'zip',
    wheel: 'without',
    operation: 'manual'
  };

  if (lower.includes('icu')) {
    defaults = {
      headfoot: 'ms',
      siderails: 'ms',
      mattress: 'zip',
      wheel: 'wheel',
      operation: 'remote'
    };
  } else if (lower.includes('semi_fowler') || lower.includes('semi-fowler')) {
    defaults = {
      headfoot: 'ms',
      siderails: 'ms',
      mattress: 'zip',
      wheel: 'without',
      operation: 'manual'
    };
  } else if (lower.includes('hi-lo') || lower.includes('hi_lo') || lower.includes('hilo')) {
    defaults = {
      headfoot: 'ms',
      siderails: 'ms',
      mattress: 'zip',
      wheel: 'wheel',
      operation: 'remote'
    };
  } else if (lower.includes('couch') || lower.includes('examination')) {
    defaults = {
      headfoot: 'ms',
      siderails: 'ms',
      mattress: 'plain',
      wheel: 'without',
      operation: 'manual'
    };
  } else if (lower.includes('attender_cot_deluxe') || lower.includes('attender-cot-deluxe')) {
    defaults = {
      headfoot: 'ss',
      siderails: 'ssplain',
      mattress: 'plain',
      wheel: 'without',
      operation: 'manual'
    };
  }

  // Update UI active states to match defaults
  document.querySelectorAll('.config-card[data-section="headfoot"]').forEach(card => {
    card.classList.toggle('active', card.dataset.value === defaults.headfoot);
  });
  document.querySelectorAll('.config-card[data-section="siderails"]').forEach(card => {
    card.classList.toggle('active', card.dataset.value === defaults.siderails);
  });
  
  const mattressRadio = document.querySelector(`input[name="mattress"][value="${defaults.mattress}"]`);
  if (mattressRadio) mattressRadio.checked = true;
  
  const wheelRadio = document.querySelector(`input[name="wheel"][value="${defaults.wheel}"]`);
  if (wheelRadio) wheelRadio.checked = true;
  
  const operationRadio = document.querySelector(`input[name="operation"][value="${defaults.operation}"]`);
  if (operationRadio) operationRadio.checked = true;
}

// == Configuration Logic ======================================================
function applyCurrentConfig() {
  if (!currentModel) return;

  if (isCurrentModelViewOnly) {
    // Show all meshes for view-only models and skip config filters
    Object.keys(meshMap).forEach(key => {
      toggleMesh(key, true);
    });
    return;
  }

  const headfoot = document.querySelector('.config-card[data-section="headfoot"].active')?.dataset.value || 'ms';
  const siderails = document.querySelector('.config-card[data-section="siderails"].active')?.dataset.value || 'ms';
  const mattress = document.querySelector('input[name="mattress"]:checked')?.value || 'zip';
  const wheel = document.querySelector('input[name="wheel"]:checked')?.value || 'without';
  const operation = document.querySelector('input[name="operation"]:checked')?.value || 'manual';
  const activeColor = document.querySelector('.color-swatch:not(.mattress-color):not(.abs-panel-color):not(.abs-rail-color):not(.couch-cabinet-color):not(.couch-drawer-color).active')?.dataset.color;
  const activeMattressColor = document.querySelector('.color-swatch.mattress-color.active')?.dataset.color;

  // Show/hide ABS Panel color section based on ABS Panel selection
  const isAbsPanelSelected = (headfoot === 'abs' || headfoot === 'abs1' || headfoot === 'abs2');
  const absPanelColorSection = document.getElementById('abs-panel-color-section');
  if (absPanelColorSection) {
    absPanelColorSection.style.display = isAbsPanelSelected ? 'flex' : 'none';
  }

  // Show/hide ABS Rail color section based on ABS Rail selection
  const isAbsRailSelected = (siderails === 'abs');
  const absRailColorSection = document.getElementById('abs-rail-color-section');
  if (absRailColorSection) {
    absRailColorSection.style.display = isAbsRailSelected ? 'flex' : 'none';
  }

  // Show/hide Couch Cabinet and Drawer color sections dynamically
  const isCouch = currentModelName.toLowerCase().includes('couch') || currentModelName.toLowerCase().includes('examination') || productName === 'Deluxe Examination Couch';
  const couchCabinetSection = document.getElementById('couch-cabinet-color-section');
  const couchDrawerSection = document.getElementById('couch-drawer-color-section');
  if (couchCabinetSection) couchCabinetSection.style.display = isCouch ? 'flex' : 'none';
  if (couchDrawerSection) couchDrawerSection.style.display = isCouch ? 'flex' : 'none';

  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    let visible = true;

    // Head / Foot panels matching
    if (name.includes('head') || name.includes('foot') || name.includes('board') || name.includes('panel') || name.includes('end')) {
      if (headfoot === 'ms') {
        if (name.includes('s3') || name.includes('ss') || name.includes('abs')) visible = false;
      } else if (headfoot === 'ss') {
        if (name.includes('m1') || name.includes('ms') || name.includes('abs')) visible = false;
      } else if (headfoot === 'abs' || headfoot === 'abs1') {
        if (name.includes('m1') || name.includes('ms') || name.includes('s3') || name.includes('ss')) visible = false;
        if (name.includes('abs') && (name.includes('2') || name.includes('abs-2') || name.includes('abs2') || name.includes('abs_2'))) visible = false;
      } else if (headfoot === 'abs2') {
        if (name.includes('m1') || name.includes('ms') || name.includes('s3') || name.includes('ss')) visible = false;
        if (name.includes('abs') && !(name.includes('2') || name.includes('abs-2') || name.includes('abs2') || name.includes('abs_2'))) visible = false;
      }
    }

    // Side Rails matching
    const isRailMesh = name.includes('rail') || name.includes('side') || name.includes('collapsible') || name.includes('colapsable') || name.includes('ac-') || name.includes('ac_');
    if (isRailMesh) {
      const isAlum = name.includes('aluminium') || name.includes('ac-') || name.includes('ac_') || name.includes('ac siderailings');
      
      if (siderails === 'ms') {
        if (name.includes('ss') || name.includes('abs') || isAlum || name.includes('collapsible') || name.includes('colapsable')) visible = false;
      } else if (siderails === 'ssplain') {
        if (name.includes('ms') || name.includes('abs') || isAlum || name.includes('collapsible') || name.includes('colapsable')) visible = false;
      } else if (siderails === 'abs') {
        if (name.includes('ms') || name.includes('ss') || isAlum || name.includes('collapsible') || name.includes('colapsable')) visible = false;
      } else if (siderails === 'aluminium') {
        if (name.includes('ms') || name.includes('abs') || name.includes('ss') || !isAlum) visible = false;
      } else if (siderails === 'sscollapsible') {
        if (name.includes('ms') || name.includes('abs') || isAlum) visible = false;
        if (name.includes('ss') && !name.includes('collapsible') && !name.includes('colapsable')) visible = false;
        if (!name.includes('ss')) visible = false;
      }
    }

    // Mattress matching
    if (name.includes('mattress') || name.includes('mattres') || name.includes('zipper') || name.includes('zip') || name.includes('cube.020') || name.includes('plain')) {
      if (mattress === 'zip') {
        if (name.includes('plain')) visible = false;
      } else if (mattress === 'plain') {
        if (name.includes('zip') || name.includes('zipper') || name.includes('cube.020')) visible = false;
      }
    }

    // Wheels matching
    if (name.includes('wheel') || name.includes('castor') || name.includes('caster')) {
      const isIcu = (currentModelName && currentModelName.toLowerCase().includes('icu')) || productName === 'ICU Cot';
      const isCouch = (currentModelName && currentModelName.toLowerCase().includes('couch')) || productName === 'Deluxe Examination Couch';
      if (wheel === 'without' && !isIcu && !isCouch) visible = false;
    }

    // Operation matching
    if (name.includes('motor') || name.includes('remote') || name.includes('crank') || name.includes('manual') || name.includes('handle')) {
      if (operation === 'manual') {
        if (name.includes('motor') || name.includes('remote')) visible = false;
      } else if (operation === 'remote') {
        if (name.includes('crank') || name.includes('manual') || name.includes('handle')) visible = false;
      }
    }

    toggleMesh(key, visible);
  });

  if (activeColor && userColorsChanged.frame) applyColorToMeshes(activeColor);
  if (activeMattressColor) applyMattressColor(activeMattressColor);
  if (isAbsPanelSelected && userColorsChanged.absPanel) {
    const activeAbsPanelColor = document.querySelector('.color-swatch.abs-panel-color.active')?.dataset.color;
    if (activeAbsPanelColor) {
      applyAbsPanelColor(activeAbsPanelColor);
    }
  }
  if (isAbsRailSelected && userColorsChanged.absRail) {
    const activeAbsRailColor = document.querySelector('.color-swatch.abs-rail-color.active')?.dataset.color;
    if (activeAbsRailColor) {
      applyAbsRailColor(activeAbsRailColor);
    }
  }
  if (isCouch) {
    const activeCouchCabinetColor = document.querySelector('.color-swatch.couch-cabinet-color.active')?.dataset.color;
    if (activeCouchCabinetColor && userColorsChanged.cabinet) {
      applyCouchCabinetColor(activeCouchCabinetColor);
    }
    const activeCouchDrawerColor = document.querySelector('.color-swatch.couch-drawer-color.active')?.dataset.color;
    if (activeCouchDrawerColor && userColorsChanged.drawer) {
      applyCouchDrawerColor(activeCouchDrawerColor);
    }
  }
}

function applyColorToMeshes(hexColorStr) {
  if (!currentModel) return;
  const hex = parseInt(hexColorStr.replace('#', ''), 16);

  if (selectedMesh && meshMap[selectedMesh]) {
    meshMap[selectedMesh].meshes.forEach(mesh => setColorOnMesh(mesh, hex));
    return;
  }

  // General model coloring for frames/panels (excluding mattress and ABS components)
  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    
    // Check if it's a side rail mesh (using same classification as visibility logic)
    const isRailMesh = name.includes('rail') || name.includes('side') || name.includes('collapsible') || name.includes('colapsable') || name.includes('ac-') || name.includes('ac_');
    const isAbsRail = isRailMesh && !name.includes('ms') && !name.includes('ss') && !name.includes('aluminium') && !name.includes('collapsible') && !name.includes('colapsable') && !name.includes('ac-') && !name.includes('ac_');
    
    // Check if it's an ABS component (either explicitly named 'abs' or classified as an ABS rail)
    const isAbs = name.includes('abs') || isAbsRail;

    if (entry.visible && !name.includes('mattress') && !isAbs && (name.includes('panel') || name.includes('rail') || name.includes('frame') || name.includes('board') || name.includes('head') || name.includes('foot') || name.includes('body') || name.includes('support'))) {
      entry.meshes.forEach(mesh => setColorOnMesh(mesh, hex));
    }
  });
}

function applyMattressColor(hexColorStr) {
  if (!currentModel) return;
  const hex = parseInt(hexColorStr.replace('#', ''), 16);

  // Mattress specific coloring
  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    if (entry.visible && (name.includes('mattress') || name.includes('mattres') || name.includes('zipper') || name.includes('zip') || name.includes('cube.020'))) {
      entry.meshes.forEach(mesh => setColorOnMesh(mesh, hex));
    }
  });
}

function applyAbsPanelColor(hexColorStr) {
  if (!currentModel) return;
  const hex = parseInt(hexColorStr.replace('#', ''), 16);

  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    
    // Target ABS head/foot panels only
    const isAbsPanel = (name.includes('abs') && (name.includes('head') || name.includes('foot') || name.includes('board') || name.includes('panel') || name.includes('end')));
    
    if (entry.visible && isAbsPanel) {
      entry.meshes.forEach(mesh => {
        if (!mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(mat => {
          const matName = mat.name.toLowerCase();
          if (matName.includes('clr') || matName.includes('color') || matName.includes('blue') || matName.includes('red') || matName.includes('sticker')) {
            const cloned = mat.clone();
            if (cloned.color) {
              cloned.color.setHex(hex);
            }
            if (cloned.emissive) {
              cloned.emissive.setHex(0x000000);
            }
            cloned.needsUpdate = true;
            if (Array.isArray(mesh.material)) {
              const idx = mesh.material.indexOf(mat);
              if (idx !== -1) mesh.material[idx] = cloned;
            } else {
              mesh.material = cloned;
            }
          }
        });
      });
    }
  });
}

function applyAbsRailColor(hexColorStr) {
  if (!currentModel) return;
  const hex = parseInt(hexColorStr.replace('#', ''), 16);

  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    
    // Target ABS side rails only
    const isAbsRail = (name.includes('abs') && (name.includes('rail') || name.includes('side')));
    
    if (entry.visible && isAbsRail) {
      entry.meshes.forEach(mesh => {
        if (!mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(mat => {
          const matName = mat.name.toLowerCase();
          if (matName.includes('clr') || matName.includes('color') || matName.includes('blue') || matName.includes('red') || matName.includes('sticker') || matName.includes('siderailings-2')) {
            const cloned = mat.clone();
            if (cloned.color) {
              cloned.color.setHex(hex);
            }
            if (cloned.emissive) {
              cloned.emissive.setHex(0x000000);
            }
            cloned.needsUpdate = true;
            if (Array.isArray(mesh.material)) {
              const idx = mesh.material.indexOf(mat);
              if (idx !== -1) mesh.material[idx] = cloned;
            } else {
              mesh.material = cloned;
            }
          }
        });
      });
    }
  });
}

function applyCouchCabinetColor(hexColorStr) {
  if (!currentModel) return;
  const hex = parseInt(hexColorStr.replace('#', ''), 16);

  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    
    const isCabinet = name.includes('cabinet') || name.includes('cabin') || name.includes('footer') || name.includes('mini_drawer') || name.includes('mini-drawer');
    
    if (entry.visible && isCabinet) {
      entry.meshes.forEach(mesh => setColorOnMesh(mesh, hex));
    }
  });
}

function applyCouchDrawerColor(hexColorStr) {
  if (!currentModel) return;
  const hex = parseInt(hexColorStr.replace('#', ''), 16);

  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    
    const isDrawer = name.includes('drawer') || name.includes('cupboard');
    const isMiniDrawer = name.includes('mini_drawer') || name.includes('mini-drawer');
    
    if (entry.visible && isDrawer && !isMiniDrawer) {
      entry.meshes.forEach(mesh => setColorOnMesh(mesh, hex));
    }
  });
}

function setColorOnMesh(mesh, hex) {
  if (!mesh.material) return;
  
  // Helper to check if a material represents metal or a handle
  const isMetalOrHandleMaterial = (mat) => {
    if (!mat) return false;
    const matName = mat.name ? mat.name.toLowerCase() : '';
    if (mat.metalness > 0.5 || 
        matName.includes('steel') || 
        matName.includes('metal') || 
        matName.includes('chrome') || 
        matName.includes('handle') || 
        matName.includes('silver') ||
        matName.includes('iron') ||
        matName.includes('brass')) {
      return true;
    }
    return false;
  };

  // Safely clone a material while explicitly preserving all PBR properties
  // (.clone() copies them but we are explicit to be safe and self-documenting)
  const cloneMat = (mat) => {
    const cloned = mat.clone();
    // Explicitly carry over PBR surface properties so they are NEVER lost
    cloned.roughness        = mat.roughness;
    cloned.metalness        = mat.metalness;
    cloned.roughnessMap     = mat.roughnessMap;
    cloned.metalnessMap     = mat.metalnessMap;
    cloned.normalMap        = mat.normalMap;
    cloned.normalScale      = mat.normalScale ? mat.normalScale.clone() : cloned.normalScale;
    cloned.map              = mat.map;          // base colour texture
    cloned.aoMap            = mat.aoMap;        // ambient occlusion
    cloned.aoMapIntensity   = mat.aoMapIntensity;
    cloned.envMapIntensity  = mat.envMapIntensity;
    cloned.transparent      = mat.transparent;
    cloned.opacity          = mat.opacity;
    cloned.side             = mat.side;
    cloned.needsUpdate      = true;
    return cloned;
  };

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(mat => {
      if (isMetalOrHandleMaterial(mat)) {
        return mat; // Keep original metal/handle material untouched
      }
      const cloned = cloneMat(mat);
      if (cloned.color) cloned.color.setHex(hex);
      // Zero emissive only if it exists (not all material types have it)
      if (cloned.emissive) cloned.emissive.setHex(0x000000);
      return cloned;
    });
  } else {
    if (isMetalOrHandleMaterial(mesh.material)) {
      return; // Keep original metal/handle material untouched
    }
    mesh.material = cloneMat(mesh.material);
    if (mesh.material.color) mesh.material.color.setHex(hex);
    if (mesh.material.emissive) mesh.material.emissive.setHex(0x000000);
  }
}

function focusOnCategory(category) {
  if (!currentModel) return;
  const box = new THREE.Box3();
  
  Object.keys(meshMap).forEach(key => {
    const entry = meshMap[key];
    const name = entry.name.toLowerCase();
    
    let match = false;
    if (category === 'headfoot') {
      match = name.includes('head') || name.includes('foot') || name.includes('board') || name.includes('panel') || name.includes('end');
      if (name.includes('rail') || name.includes('side') || name.includes('mattress') || name.includes('mattres')) {
        match = false;
      }
    } else if (category === 'siderails') {
      match = name.includes('rail') || name.includes('side') || name.includes('collapsible') || name.includes('colapsable') || name.includes('ac-') || name.includes('ac_');
    } else if (category === 'mattress') {
      match = name.includes('mattress') || name.includes('mattres') || name.includes('zipper') || name.includes('zip') || name.includes('cube.020') || name.includes('plain') || name.includes('lather');
      if (name.includes('panel') || name.includes('board') || name.includes('head') || name.includes('foot') || name.includes('end')) {
        match = false;
      }
    } else if (category === 'cabinet') {
      match = name.includes('cabinet') || name.includes('cupboard') || name.includes('cabin') || name.includes('footer');
    } else if (category === 'drawer') {
      match = name.includes('drawer') || name.includes('cupboard');
    } else if (category === 'wheel') {
      match = name.includes('wheel') || name.includes('castor') || name.includes('caster');
    } else if (category === 'operation') {
      match = name.includes('motor') || name.includes('remote') || name.includes('crank') || name.includes('manual') || name.includes('handle');
    }
    
    if (entry.visible && match) {
      entry.meshes.forEach(mesh => {
        box.expandByObject(mesh);
      });
    }
  });

  if (box.isEmpty()) return;

  const centre = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxSz  = Math.max(size.x, size.y, size.z);

  if (!isFinite(maxSz) || maxSz === 0) return;

  const fov  = camera.fov * (Math.PI / 180);
  const dist = (maxSz / 2) / Math.tan(fov / 2) * 2.2;

  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  if (dir.lengthSq() === 0) {
    dir.set(0.6, 0.4, 1).normalize();
  }

  controls.target.copy(centre);
  camera.position.copy(centre).addScaledVector(dir, dist);
  controls.update();
}

// Setup configuration panel event listeners
document.querySelectorAll('.config-card').forEach(card => {
  card.addEventListener('click', () => {
    const section = card.dataset.section;
    document.querySelectorAll(`.config-card[data-section="${section}"]`).forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    applyCurrentConfig();
  });
});

document.querySelectorAll('input[type="radio"]').forEach(radio => {
  radio.addEventListener('change', applyCurrentConfig);
});

document.querySelectorAll('.color-swatch:not(.mattress-color):not(.couch-cabinet-color):not(.couch-drawer-color):not(.abs-panel-color):not(.abs-rail-color)').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    if (swatch.id === 'custom-color-swatch') {
      const picker = document.getElementById('custom-color-picker');
      if (picker && e.target !== picker) {
        picker.click();
      }
      return;
    }
    document.querySelectorAll('.color-swatch:not(.mattress-color):not(.couch-cabinet-color):not(.couch-drawer-color):not(.abs-panel-color):not(.abs-rail-color)').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    userColorsChanged.frame = true;
    applyCurrentConfig();
  });
});

const customColorPicker = document.getElementById('custom-color-picker');
const customColorSwatch = document.getElementById('custom-color-swatch');
if (customColorPicker && customColorSwatch) {
  const handleCustomColor = (e) => {
    const hexColor = e.target.value;
    customColorSwatch.dataset.color = hexColor;
    customColorSwatch.style.background = hexColor;
    
    document.querySelectorAll('.color-swatch:not(.mattress-color):not(.couch-cabinet-color):not(.couch-drawer-color):not(.abs-panel-color):not(.abs-rail-color)').forEach(s => s.classList.remove('active'));
    customColorSwatch.classList.add('active');
    userColorsChanged.frame = true;
    applyCurrentConfig();
  };
  customColorPicker.addEventListener('input', handleCustomColor);
  customColorPicker.addEventListener('change', handleCustomColor);
}

// Mattress color swatches listeners
document.querySelectorAll('.mattress-color').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    document.querySelectorAll('.mattress-color').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    userColorsChanged.mattress = true;
    applyCurrentConfig();
  });
});

// Couch Cabinet color swatches listeners
document.querySelectorAll('.couch-cabinet-color').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    if (swatch.id === 'couch-cabinet-custom-swatch') {
      const picker = document.getElementById('couch-cabinet-custom-picker');
      if (picker && e.target !== picker) {
        picker.click();
      }
      return;
    }
    document.querySelectorAll('.couch-cabinet-color').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    userColorsChanged.cabinet = true;
    applyCurrentConfig();
  });
});

const couchCabinetCustomPicker = document.getElementById('couch-cabinet-custom-picker');
const couchCabinetCustomSwatch = document.getElementById('couch-cabinet-custom-swatch');
if (couchCabinetCustomPicker && couchCabinetCustomSwatch) {
  const handleCouchCabinetCustomColor = (e) => {
    const hexColor = e.target.value;
    couchCabinetCustomSwatch.dataset.color = hexColor;
    couchCabinetCustomSwatch.style.background = hexColor;
    
    document.querySelectorAll('.couch-cabinet-color').forEach(s => s.classList.remove('active'));
    couchCabinetCustomSwatch.classList.add('active');
    userColorsChanged.cabinet = true;
    applyCurrentConfig();
  };
  couchCabinetCustomPicker.addEventListener('input', handleCouchCabinetCustomColor);
  couchCabinetCustomPicker.addEventListener('change', handleCouchCabinetCustomColor);
}

// Couch Drawer color swatches listeners
document.querySelectorAll('.couch-drawer-color').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    if (swatch.id === 'couch-drawer-custom-swatch') {
      const picker = document.getElementById('couch-drawer-custom-picker');
      if (picker && e.target !== picker) {
        picker.click();
      }
      return;
    }
    document.querySelectorAll('.couch-drawer-color').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    userColorsChanged.drawer = true;
    applyCurrentConfig();
  });
});

const couchDrawerCustomPicker = document.getElementById('couch-drawer-custom-picker');
const couchDrawerCustomSwatch = document.getElementById('couch-drawer-custom-swatch');
if (couchDrawerCustomPicker && couchDrawerCustomSwatch) {
  const handleCouchDrawerCustomColor = (e) => {
    const hexColor = e.target.value;
    couchDrawerCustomSwatch.dataset.color = hexColor;
    couchDrawerCustomSwatch.style.background = hexColor;
    
    document.querySelectorAll('.couch-drawer-color').forEach(s => s.classList.remove('active'));
    couchDrawerCustomSwatch.classList.add('active');
    userColorsChanged.drawer = true;
    applyCurrentConfig();
  };
  couchDrawerCustomPicker.addEventListener('input', handleCouchDrawerCustomColor);
  couchDrawerCustomPicker.addEventListener('change', handleCouchDrawerCustomColor);
}

// ABS Panel color swatches listeners
document.querySelectorAll('.abs-panel-color').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    if (swatch.id === 'abs-panel-custom-swatch') {
      const picker = document.getElementById('abs-panel-custom-picker');
      if (picker && e.target !== picker) {
        picker.click();
      }
      return;
    }
    document.querySelectorAll('.abs-panel-color').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    userColorsChanged.absPanel = true;
    applyCurrentConfig();
  });
});

const absPanelCustomPicker = document.getElementById('abs-panel-custom-picker');
const absPanelCustomSwatch = document.getElementById('abs-panel-custom-swatch');
if (absPanelCustomPicker && absPanelCustomSwatch) {
  const handleAbsPanelCustomColor = (e) => {
    const hexColor = e.target.value;
    absPanelCustomSwatch.dataset.color = hexColor;
    absPanelCustomSwatch.style.background = hexColor;
    
    document.querySelectorAll('.abs-panel-color').forEach(s => s.classList.remove('active'));
    absPanelCustomSwatch.classList.add('active');
    userColorsChanged.absPanel = true;
    applyCurrentConfig();
  };
  absPanelCustomPicker.addEventListener('input', handleAbsPanelCustomColor);
  absPanelCustomPicker.addEventListener('change', handleAbsPanelCustomColor);
}

// ABS Rail color swatches listeners
document.querySelectorAll('.abs-rail-color').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    if (swatch.id === 'abs-rail-custom-swatch') {
      const picker = document.getElementById('abs-rail-custom-picker');
      if (picker && e.target !== picker) {
        picker.click();
      }
      return;
    }
    document.querySelectorAll('.abs-rail-color').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    userColorsChanged.absRail = true;
    applyCurrentConfig();
  });
});

const absRailCustomPicker = document.getElementById('abs-rail-custom-picker');
const absRailCustomSwatch = document.getElementById('abs-rail-custom-swatch');
if (absRailCustomPicker && absRailCustomSwatch) {
  const handleAbsRailCustomColor = (e) => {
    const hexColor = e.target.value;
    absRailCustomSwatch.dataset.color = hexColor;
    absRailCustomSwatch.style.background = hexColor;
    
    document.querySelectorAll('.abs-rail-color').forEach(s => s.classList.remove('active'));
    absRailCustomSwatch.classList.add('active');
    userColorsChanged.absRail = true;
    applyCurrentConfig();
  };
  absRailCustomPicker.addEventListener('input', handleAbsRailCustomColor);
  absRailCustomPicker.addEventListener('change', handleAbsRailCustomColor);
}

// Auto Rotate toggle listener
const autoRotateToggle = document.getElementById('auto-rotate-toggle-cb');
if (autoRotateToggle) {
  autoRotateToggle.addEventListener('change', (e) => {
    controls.autoRotate = e.target.checked;
  });
}

// Developer Mesh Inspector Drawer Toggle
const inspectorSidebar = document.getElementById('sidebar');
const inspectorToggleBtn = document.getElementById('inspector-toggle-btn');
const closeInspectorBtn = document.getElementById('close-inspector-btn');

inspectorToggleBtn.addEventListener('click', () => {
  inspectorSidebar.classList.toggle('open');
  inspectorToggleBtn.classList.toggle('active', inspectorSidebar.classList.contains('open'));
});

closeInspectorBtn.addEventListener('click', () => {
  inspectorSidebar.classList.remove('open');
  inspectorToggleBtn.classList.remove('active');
});

// == Toolbar actions ===========================================================
document.getElementById('show-all-btn').addEventListener('click', () => {
  Object.keys(meshMap).forEach(k => toggleMesh(k, true));
  showToast('All meshes visible');
});

document.getElementById('hide-all-btn').addEventListener('click', () => {
  selectedMesh = null;
  Object.keys(meshMap).forEach(k => toggleMesh(k, false));
  showToast('All meshes hidden');
});

document.getElementById('isolate-btn').addEventListener('click', () => {
  if (!selectedMesh) { showToast('Click a mesh in Inspector first to isolate'); return; }
  const name = meshMap[selectedMesh]?.name ?? selectedMesh;
  Object.keys(meshMap).forEach(k => toggleMesh(k, k === selectedMesh));
  showToast(`Isolated "${name}"`);
});

document.getElementById('mesh-search').addEventListener('input', (e) => {
  buildMeshList(e.target.value);
});

// == HUD ======================================================================
document.getElementById('reset-cam-btn').addEventListener('click', () => {
  if (!defaultCamPos) return;
  camera.position.copy(defaultCamPos);
  controls.target.copy(defaultCamTarget);
  controls.update();
  showToast('Camera reset');
});

document.getElementById('wireframe-btn').addEventListener('click', () => {
  wireframeMode = !wireframeMode;
  document.getElementById('wireframe-btn').classList.toggle('active', wireframeMode);
  if (currentModel) {
    currentModel.traverse(child => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => { m.wireframe = child.visible ? wireframeMode : false; });
      }
    });
  }
  showToast(wireframeMode ? 'Wireframe on' : 'Wireframe off');
});

document.getElementById('grid-btn').addEventListener('click', () => {
  floorPlane.visible = !floorPlane.visible;
  document.getElementById('grid-btn').classList.toggle('active', floorPlane.visible);
});

document.getElementById('bg-color-picker').addEventListener('input', (e) => {
  const bgColor = new THREE.Color(e.target.value);
  scene.background = bgColor;
});

// == Viewport click raycasting ===============================================
let pointerDownX = 0;
let pointerDownY = 0;
let pointerDownTime = 0;

canvas.addEventListener('pointerdown', (e) => {
  pointerDownX = e.clientX;
  pointerDownY = e.clientY;
  pointerDownTime = performance.now();
});

canvas.addEventListener('pointerup', (e) => {
  const diffX = Math.abs(e.clientX - pointerDownX);
  const diffY = Math.abs(e.clientY - pointerDownY);
  const diffTime = performance.now() - pointerDownTime;

  if (diffX < 3 && diffY < 3 && diffTime < 250) {
    onCanvasClick(e);
  }
});

function onCanvasClick(event) {
  if (!currentModel) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const meshes = [];
  currentModel.traverse((child) => {
    if (child.isMesh && child.visible) {
      meshes.push(child);
    }
  });

  const intersects = raycaster.intersectObjects(meshes, true);

  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;

    let matchedKey = null;
    for (const key in meshMap) {
      if (meshMap[key].meshes.includes(clickedMesh)) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      blinkMesh(clickedMesh);

      // Open the developer drawer if not open to show selected mesh
      if (!inspectorSidebar.classList.contains('open')) {
        inspectorSidebar.classList.add('open');
        inspectorToggleBtn.classList.add('active');
      }

      const itemEl = meshListEl.querySelector(`[data-key="${matchedKey}"]`);
      if (itemEl) {
        itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        focusMesh(matchedKey, itemEl, true);
      }
    }
  }
}

function blinkMesh(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const originalColors = [];

  materials.forEach((mat) => {
    if (mat.emissive) {
      originalColors.push({ mat, type: 'emissive', val: mat.emissive.clone() });
      mat.emissive.setHex(0xEA580C);
    } else if (mat.color) {
      originalColors.push({ mat, type: 'color', val: mat.color.clone() });
      mat.color.setHex(0xEA580C);
    }
  });

  setTimeout(() => {
    originalColors.forEach(({ mat, type, val }) => {
      if (type === 'emissive') {
        mat.emissive.copy(val);
      } else if (type === 'color') {
        mat.color.copy(val);
      }
    });
  }, 350);
}

document.getElementById('bg-btn').addEventListener('click', () => {
  bgIndex = (bgIndex + 1) % bgColors.length;
  scene.background = new THREE.Color(bgColors[bgIndex]);
});

// == Export Model =============================================================
const exportBtn = document.getElementById('export-btn');
const exportDropdown = document.getElementById('export-dropdown');

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportDropdown.classList.toggle('show');
});

document.addEventListener('click', () => {
  exportDropdown.classList.remove('show');
});

document.getElementById('export-glb').addEventListener('click', () => {
  exportModel({ binary: true, ext: 'glb' });
});

document.getElementById('export-gltf').addEventListener('click', () => {
  exportModel({ binary: false, ext: 'gltf' });
});

function exportModel(options) {
  if (!currentModel) {
    showToast('No model loaded to export');
    return;
  }

  showToast('Exporting model...');
  const exporter = new GLTFExporter();
  
  const exportOptions = {
    binary: options.binary,
    onlyVisible: true
  };

  try {
    exporter.parse(currentModel, (result) => {
      let output;
      if (options.binary) {
        output = new Blob([result], { type: 'application/octet-stream' });
      } else {
        output = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      }

      let baseName = 'model-export';
      const badgeName = document.getElementById('badge-name').textContent;
      if (badgeName && badgeName !== '-') {
        baseName = badgeName.replace(/\.[^/.]+$/, "");
      }
      const fileName = `${baseName}_exported.${options.ext}`;

      const link = document.createElement('a');
      link.href = URL.createObjectURL(output);
      link.download = fileName;
      link.click();
      
      setTimeout(() => URL.revokeObjectURL(link.href), 100);
      showToast(`Exported as ${options.ext.toUpperCase()}`);
    }, exportOptions);
  } catch (error) {
    console.error('Export error:', error);
    showToast('Failed to export model');
  }
}

// == File input ================================================================
const fileInput = document.getElementById('file-input');
document.getElementById('upload-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) { loadModel(f); e.target.value = ''; }
});

// == Drag & drop ===============================================================
const dropZone = document.getElementById('drop-zone');
let dragTimer  = null;

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('visible');
  clearTimeout(dragTimer);
});

document.addEventListener('dragleave', () => {
  dragTimer = setTimeout(() => dropZone.classList.remove('visible'), 100);
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('visible');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const ext = file.name.toLowerCase().split('.').pop();
  if (['fbx', 'glb', 'gltf', 'obj'].includes(ext)) {
    loadModel(file);
  } else {
    showToast('Please drop a .fbx, .glb, .gltf, or .obj file');
  }
});

// == Toast =====================================================================
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
}

// Load default model from root URL on page load
let defaultModel = 'assets/models/view-only-models/semi-fowler-cot.glb';
let productName = 'Semi Fowler Cot';

// Parse query params or hash parameters for the model
try {
  const urlParams = new URLSearchParams(window.location.search);
  const hashVal = window.location.hash.toLowerCase().replace('#', '');
  const modelQuery = (urlParams.get('model') || hashVal || '').toLowerCase();
  
  if (modelQuery.includes('deluxe-examination-couch') || modelQuery.includes('couch') || modelQuery.includes('examination')) {
    defaultModel = 'assets/models/customisation-models/deluxe-examination-couch.glb';
    productName = 'Deluxe Examination Couch';
  } else if (modelQuery.includes('semi-fowler') || modelQuery.includes('semi_fowler')) {
    defaultModel = 'assets/models/view-only-models/semi-fowler-cot.glb';
    productName = 'Semi Fowler Cot';
  } else if (modelQuery.includes('fowler-cot') || modelQuery.includes('fowler')) {
    defaultModel = 'assets/models/customisation-models/fowler-cot.glb';
    productName = 'Fowler Cot';
  } else if (modelQuery.includes('hi-lo') || modelQuery.includes('hilo') || modelQuery.includes('strecher')) {
    defaultModel = 'assets/models/customisation-models/hi-lo-strecher.glb';
    productName = 'Hi-Lo Structure';
  } else if (modelQuery.includes('icu')) {
    defaultModel = 'assets/models/customisation-models/icu-cot.glb';
    productName = 'ICU Cot';
  } else if (modelQuery.includes('labor-cot') || modelQuery.includes('deluxe-double-door') || modelQuery.includes('deluxe_double_door')) {
    defaultModel = 'assets/models/customisation-models/labor-cot.glb';
    productName = 'Deluxe Double Door Attender Cot';
  } else if (modelQuery.includes('over-bed-table') || modelQuery.includes('overbed')) {
    defaultModel = 'assets/models/view-only-models/over-bed-table.glb';
    productName = 'Over Bed Table';
  } else if (modelQuery.includes('attender-cot-deluxe') || modelQuery.includes('attender_cot_deluxe')) {
    defaultModel = 'assets/models/view-only-models/attender-cot/attender-cot-deluxe.glb';
    productName = 'Attender Cot Deluxe';
  } else if (modelQuery.includes('attender-cot') || modelQuery.includes('attender_cot')) {
    defaultModel = 'assets/models/view-only-models/attender-cot/attender-cot.glb';
    productName = 'Attender Cot Plain';
  } else if (modelQuery.includes('bedside-locker-deluxe') || modelQuery.includes('sidelocker_deluxe') || modelQuery.includes('sidelocker-deluxe')) {
    defaultModel = 'assets/models/view-only-models/bedside-locker/bedside-locker-deluxe.glb';
    productName = 'Bed Sidelocker Deluxe Wood';
  } else if (modelQuery.includes('bedside-locker') || modelQuery.includes('locker_plain') || modelQuery.includes('locker-plain')) {
    defaultModel = 'assets/models/view-only-models/bedside-locker/bedside-locker.glb';
    productName = 'Bedside Locker Plain';
  }
} catch (e) {
  console.warn('URL parsing fallback:', e);
}

// Update the product selector value dynamically to match the loaded model
const selectorEl = document.getElementById('product-selector');
if (selectorEl) {
  const urlParams = new URLSearchParams(window.location.search);
  const hashVal = window.location.hash.toLowerCase().replace('#', '');
  const modelQuery = (urlParams.get('model') || hashVal || 'semi-fowler').toLowerCase();
  
  if (modelQuery.includes('deluxe-examination-couch') || modelQuery.includes('couch') || modelQuery.includes('examination')) {
    selectorEl.value = 'couch';
  } else if (modelQuery.includes('semi-fowler') || modelQuery.includes('semi_fowler')) {
    selectorEl.value = 'semi-fowler';
  } else if (modelQuery.includes('fowler-cot') || modelQuery.includes('fowler')) {
    selectorEl.value = 'fowler-cot';
  } else if (modelQuery.includes('hi-lo') || modelQuery.includes('hilo') || modelQuery.includes('strecher')) {
    selectorEl.value = 'hi-lo';
  } else if (modelQuery.includes('icu')) {
    selectorEl.value = 'icu';
  } else if (modelQuery.includes('labor-cot') || modelQuery.includes('deluxe-double-door') || modelQuery.includes('deluxe_double_door')) {
    selectorEl.value = 'labor-cot';
  } else if (modelQuery.includes('over-bed-table') || modelQuery.includes('overbed')) {
    selectorEl.value = 'over-bed-table';
  } else if (modelQuery.includes('attender-cot-deluxe') || modelQuery.includes('attender_cot_deluxe')) {
    selectorEl.value = 'attender-cot-deluxe';
  } else if (modelQuery.includes('attender-cot') || modelQuery.includes('attender_cot')) {
    selectorEl.value = 'attender-cot';
  } else if (modelQuery.includes('bedside-locker-deluxe') || modelQuery.includes('sidelocker_deluxe') || modelQuery.includes('sidelocker-deluxe')) {
    selectorEl.value = 'bedside-locker-deluxe';
  } else if (modelQuery.includes('bedside-locker') || modelQuery.includes('locker_plain') || modelQuery.includes('locker-plain')) {
    selectorEl.value = 'bedside-locker';
  }

  // Handle dropdown change event to reload the app with the new hash parameter
  selectorEl.addEventListener('change', (e) => {
    window.location.hash = e.target.value;
  });
}

loadModel(defaultModel);

// Listen to hash changes and reload model context dynamically
window.addEventListener('hashchange', () => {
  window.location.reload();
});

