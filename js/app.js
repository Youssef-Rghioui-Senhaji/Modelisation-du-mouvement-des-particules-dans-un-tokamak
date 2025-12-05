/*
app.js : centralise l'initialisation, la UI, et la simulation GPU.
Version v.1: scripts séparés (non-ESM) + compute shader pour positions/velocities
*/

(function(){
// ------- Configuration -------
const PARTICLE_TEXTURE_SIZE = 32; // 32x32 = 1024 particles by default
let numParticles = 1024;
let B0 = 10.0;

// ------- THREE.js scene -------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

camera.position.set(0, 60, 120);
camera.lookAt(0,0,0);

// OrbitControls from three r128 are not provided as module, but we can use simple interaction if needed

// Basic resize handling
window.addEventListener('resize', ()=>{camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);});

// ------- GPU computation setup -------
let texWidth = PARTICLE_TEXTURE_SIZE;
let texHeight = PARTICLE_TEXTURE_SIZE;
let gpuCompute = new GPUComputationRenderer(texWidth, texHeight, renderer);

// helpers to create data textures
function createDataTexture(fillFn){
const size = texWidth * texHeight;
const data = new Float32Array(4 * size);
for(let i=0;i<size;i++){
const stride = i*4;
const v = fillFn(i);
data[stride] = v[0] || 0;
data[stride+1] = v[1] || 0;
data[stride+2] = v[2] || 0;
data[stride+3] = v[3] || 1;
}
const dt = new THREE.DataTexture(data, texWidth, texHeight, THREE.RGBAFormat, THREE.FloatType);
dt.needsUpdate = true; dt.wrapS = dt.wrapT = THREE.RepeatWrapping; dt.minFilter = dt.magFilter = THREE.NearestFilter;
return dt;
}

// Initial positions on a torus-ish distribution
function initPosition(i){
const idx = i;
const u = (idx % texWidth) / texWidth;
const v = Math.floor(idx / texWidth) / texHeight;
const R = 40.0;
const r = 10.0 * (0.5 + 0.5*Math.random());
const th = u * Math.PI*2.0;
const ph = v * Math.PI*2.0;
const x = (R + r * Math.cos(th)) * Math.cos(ph);
const y = r * Math.sin(th) * 0.3;
const z = (R + r * Math.cos(th)) * Math.sin(ph);
return [x,y,z,1.0];
}
function initVelocity(i){
// tangential velocity
const pos = initPosition(i);
const x=pos[0], y=pos[1], z=pos[2];
const phi = Math.atan2(z,x);
const vx = -Math.sin(phi)*50.0*(0.8+0.4*Math.random());
const vy = 0.0;
const vz = Math.cos(phi)*50.0*(0.8+0.4*Math.random());
return [vx,vy,vz,1.0];
}

const pos0 = createDataTexture(i => initPosition(i));
const vel0 = createDataTexture(i => initVelocity(i));

// fragment shader that updates velocity
const velocityFragmentShader = `
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float delta;
uniform float time;
uniform float B0;
varying vec2 vUv;

```
void main(){
  vec3 pos = texture2D(texturePosition, vUv).xyz;
  vec3 vel = texture2D(textureVelocity, vUv).xyz;

  // simple central attraction towards torus center + toroidal B as perturbation
  vec3 center = vec3(0.0, 0.0, 0.0);
  vec3 dir = center - pos;
  float dist = length(dir) + 1e-5;
  vec3 acc = normalize(dir) * (10.0 / (dist));

  // Toroidal-like perturbation depending on phi
  float phi = atan(pos.z, pos.x);
  vec3 Bt = vec3(-sin(phi), 0.0, cos(phi)) * (B0 * 0.001);
  // Lorentz-like v cross B
  vec3 lor = cross(vel, Bt);

  vec3 newVel = vel + (acc + lor) * delta;

  // simple speed limit
  float vmax = 300.0;
  if(length(newVel) > vmax) newVel = normalize(newVel) * vmax;

  gl_FragColor = vec4(newVel, 1.0);
}
```

`;

// fragment shader that updates position
const positionFragmentShader = `     uniform sampler2D texturePosition;
    uniform sampler2D textureVelocity;
    uniform float delta;
    varying vec2 vUv;
    void main(){
      vec3 pos = texture2D(texturePosition, vUv).xyz;
      vec3 vel = texture2D(textureVelocity, vUv).xyz;
      vec3 newPos = pos + vel * delta;
      // keep within a large bounds via simple torus reflection
      float R = 40.0; float r = 12.0;
      float Rp = length(vec2(pos.x,pos.z));
      float reff = length(vec2(pos.y, Rp - R));
      if(reff > r){
        // reflect velocity: simple clamp back toward center
        newPos = pos - normalize(vec3(pos.x, pos.y, pos.z)) * 0.5 * (reff - r);
      }
      gl_FragColor = vec4(newPos, 1.0);
    }
  `;

// add variables to GPU compute
const velVar = gpuCompute.addVariable('textureVelocity', velocityFragmentShader, vel0);
const posVar = gpuCompute.addVariable('texturePosition', positionFragmentShader, pos0);
// pos depends on vel; vel depends on pos
gpuCompute.setVariableDependencies(velVar, [posVar]);
gpuCompute.setVariableDependencies(posVar, [velVar]);

// init
gpuCompute.init();

// ------- particle system rendering (instanced) -------
const particleCount = texWidth * texHeight;
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
const uvs = new Float32Array(particleCount * 2);
let p = 0; let u = 0;
for(let j=0;j<texHeight;j++){
for(let i=0;i<texWidth;i++){
positions[p++] = 0; positions[p++] = 0; positions[p++] = 0;
uvs[u++] = i / (texWidth - 1);
uvs[u++] = j / (texHeight - 1);
}
}
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

const particleMat = new THREE.ShaderMaterial({
uniforms: {
texturePosition: {value: null},
pointSize: {value: 3.0},
cameraScale: {value:1.0}
},
vertexShader: `       uniform sampler2D texturePosition;
      uniform float pointSize;
      varying vec3 vColor;
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec3 pos = texture2D(texturePosition, uv).xyz;
        vColor = vec3(0.5 + 0.5*sign(pos.x), 0.3, 1.0);
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = pointSize * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
fragmentShader: `       varying vec3 vColor;
      void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
transparent: true
});

const particles = new THREE.Points(geometry, particleMat);
scene.add(particles);

// ------- UI bindings -------
const numSlider = document.getElementById('numParticles');
const numVal = document.getElementById('numParticlesVal');
numVal.textContent = numParticles;
numSlider.addEventListener('input', ()=>{
numVal.textContent = numSlider.value;
// for simplicity we do not recreate textures live; just inform the user
});
const b0Slider = document.getElementById('sliderB0'); const b0Val = document.getElementById('B0Val');
b0Val.textContent = B0;
b0Slider.addEventListener('input', ()=>{B0 = Number(b0Slider.value); b0Val.textContent = B0;});

document.getElementById('btnReset').addEventListener('click', ()=>{ // re-init textures
const newPos = createDataTexture(i=>initPosition(i));
const newVel = createDataTexture(i=>initVelocity(i));
// write them to render targets
gpuCompute.renderTexture(newPos, posVar.renderTargets[0]);
gpuCompute.renderTexture(newPos, posVar.renderTargets[1]);
gpuCompute.renderTexture(newVel, velVar.renderTargets[0]);
gpuCompute.renderTexture(newVel, velVar.renderTargets[1]);
});

// ------- animation loop -------
let last = performance.now();
function animate(){
requestAnimationFrame(animate);
const now = performance.now();
let delta = Math.min(0.05, (now - last) * 0.001);
last = now;

```
// set uniforms
velVar.material.uniforms.texturePosition = {value: gpuCompute.getCurrentRenderTarget(posVar).texture};
velVar.material.uniforms.textureVelocity = {value: gpuCompute.getCurrentRenderTarget(velVar).texture};
velVar.material.uniforms.delta = {value: delta};
velVar.material.uniforms.time = {value: now*0.001};
velVar.material.uniforms.B0 = {value: B0};

posVar.material.uniforms.texturePosition = {value: gpuCompute.getCurrentRenderTarget(posVar).texture};
posVar.material.uniforms.textureVelocity = {value: gpuCompute.getCurrentRenderTarget(velVar).texture};
posVar.material.uniforms.delta = {value: delta};

// compute
gpuCompute.compute(now*0.001, delta);

// set particle material to read updated positions
particleMat.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(posVar).texture;

renderer.render(scene, camera);
```

}
animate();

})();