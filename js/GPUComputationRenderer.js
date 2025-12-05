--- FILE: js/GPUComputationRenderer.js ---

/*
Adapted minimal GPUComputationRenderer from three.js examples
*/

(function(global){
// Simplified/compatible port of three.js examples GPUComputationRenderer
function GPUComputationRenderer(sizeX, sizeY, renderer){
this.sizeX = sizeX; this.sizeY = sizeY; this.renderer = renderer;
this.meshes = [];
this.scene = new THREE.Scene();
this.camera = new THREE.Camera(); this.camera.position.z = 1;
this.passThruUniforms = { texture: { value: null } };
var material = new THREE.ShaderMaterial({
uniforms: this.passThruUniforms,
vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position,1.0);} ',
fragmentShader: 'uniform sampler2D texture; varying vec2 vUv; void main(){gl_FragColor=texture2D(texture,vUv);} '
});
var geom = new THREE.PlaneBufferGeometry(2,2);
var mesh = new THREE.Mesh(geom, material);
this.scene.add(mesh);
this.materials = {};
this.variables = [];
}
GPUComputationRenderer.prototype.addVariable = function(name, fragmentShader, initialValueTexture){
var material = new THREE.ShaderMaterial({
uniforms: { texture: { value: null } },
vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position,1.0);} ',
fragmentShader: fragmentShader
});
var renderTargetA = new THREE.WebGLRenderTarget(this.sizeX, this.sizeY, {wrapS:THREE.RepeatWrapping,wrapT:THREE.RepeatWrapping,magFilter:THREE.NearestFilter,minFilter:THREE.NearestFilter,format:THREE.RGBAFormat,type:THREE.FloatType});
var renderTargetB = renderTargetA.clone();
this.variables.push({name:name, material:material, renderTargets:[renderTargetA, renderTargetB], initialValueTexture:initialValueTexture, dependencies:[]});
return this.variables[this.variables.length-1];
};
GPUComputationRenderer.prototype.setVariableDependencies = function(variable, deps){ variable.dependencies = deps; };
GPUComputationRenderer.prototype.init = function(){
// create render targets with initial state
var gl = this.renderer.getContext();
if(!gl.getExtension('OES_texture_float')) console.warn('Float textures not supported');
// create a scene for each variable
for(var i=0;i<this.variables.length;i++){
var variable = this.variables[i];
var material = variable.material;
material.uniforms.time = {value:0};
material.uniforms.delta = {value:0};
for(var j=0;j<variable.dependencies.length;j++){ material.uniforms[variable.dependencies[j].name] = {value:null}; }
// create mesh
var mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2), material);
variable.mesh = mesh;
}
// fill initial textures
var oldClearColor = new THREE.Color();
for(var i=0;i<this.variables.length;i++){
var variable = this.variables[i];
this.renderTexture(variable.initialValueTexture, variable.renderTargets[0]);
this.renderTexture(variable.initialValueTexture, variable.renderTargets[1]);
}
return null;
};
GPUComputationRenderer.prototype.compute = function(time, delta){
for(var i=0;i<this.variables.length;i++){
var variable = this.variables[i];
var writeRT = variable.renderTargets[ (variable.current === undefined || variable.current===0) ? 1 : 0];
var readRT = variable.renderTargets[ (variable.current === undefined || variable.current===0) ? 0 : 1];
// set dependencies
for(var d=0; d<variable.dependencies.length; d++){
variable.material.uniforms[variable.dependencies[d].name].value = variable.dependencies[d].renderTargets[variable.dependencies[d].current?0:1].texture;
}
variable.material.uniforms.texture = {value: readRT.texture};
variable.material.uniforms.time.value = time; variable.material.uniforms.delta.value = delta;
this.renderer.setRenderTarget(writeRT);
this.renderer.render(variable.mesh, this.camera);
this.renderer.setRenderTarget(null);
variable.current = variable.current ? 0 : 1;
}
};
GPUComputationRenderer.prototype.getCurrentRenderTarget = function(variable){ return variable.renderTargets[variable.current?0:1]; };
GPUComputationRenderer.prototype.renderTexture = function(input, renderTarget){
// input: ImageData-like canvas/texture or null -> clear
if(input){
// we assume input is a DataTexture or null
var old = this.passThruUniforms.texture.value;
this.passThruUniforms.texture.value = input;
this.renderer.setRenderTarget(renderTarget);
this.renderer.render(this.scene, this.camera);
this.renderer.setRenderTarget(null);
this.passThruUniforms.texture.value = old;
} else {
// clear
this.renderer.setRenderTarget(renderTarget); this.renderer.clear(); this.renderer.setRenderTarget(null);
}
};
global.GPUComputationRenderer = GPUComputationRenderer;
})(this);

--- END: js/GPUComputationRenderer.js ---
