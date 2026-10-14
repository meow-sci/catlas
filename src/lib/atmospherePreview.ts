import * as THREE from "three";
import {
  cloudLayerBounds,
  compileCloudProfile,
  nativeAtmosphereHeightKm,
  nativeCloudDirection,
  sampleCloud,
} from "./atmosphere";
import { cloudPixels } from "./atmosphereExport";
import { compileSurfaceSampler } from "./procedural";
import type { CloudLayerSettings, OceanSettings, Planet } from "./types";

const vertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec3 vWorldNormal;
void main(){
  vec4 world = modelMatrix * vec4(position,1.0);
  vWorldPosition = world.xyz;
  vLocalPosition = position;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}`;

const atmosphereFragment = `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vWorldPosition;
uniform vec3 bodyCenter;
uniform vec3 sunDirection;
uniform float bodyRadius;
uniform float bottomRadius;
uniform float topRadius;
uniform float kmPerUnit;
uniform vec3 rayleigh;
uniform vec3 mie;
uniform vec3 absorption;
uniform vec3 mieAsymmetry;
uniform float rayleighHeight;
uniform float mieHeight;
uniform float mieAbsorption;
uniform float ozoneAltitude;
uniform float ozoneExtent;
vec2 sphere(vec3 p,vec3 d,float radius){
  float b=dot(p,d), c=dot(p,p)-radius*radius, disc=b*b-c;
  if(disc<0.0) return vec2(1e20,-1e20);
  float root=sqrt(disc);return vec2(-b-root,-b+root);
}
vec3 densities(vec3 p){
  float h=max(0.0,(length(p)-bottomRadius)*kmPerUnit);
  float ozone=clamp(1.0-abs(h-ozoneAltitude)/max(ozoneExtent,0.0001),0.0,1.0);
  return vec3(exp(-h/rayleighHeight),exp(-h/mieHeight),ozone);
}
vec3 extinction(vec3 density){return rayleigh*density.x+mie*mieAbsorption*density.y+absorption*density.z;}
vec3 sunTransmission(vec3 p){
  vec2 ground=sphere(p,sunDirection,bodyRadius);
  if(ground.x>0.0&&ground.y>0.0)return vec3(0.0);
  vec2 boundary=sphere(p,sunDirection,topRadius);
  float stepSize=max(0.0,boundary.y)/float(LIGHT_STEPS);
  vec3 tau=vec3(0.0);
  for(int i=0;i<LIGHT_STEPS;i++)tau+=extinction(densities(p+sunDirection*(float(i)+0.5)*stepSize))*stepSize*kmPerUnit;
  return exp(-tau);
}
void main(){
  #include <logdepthbuf_fragment>
  vec3 origin=cameraPosition-bodyCenter;
  vec3 direction=normalize(vWorldPosition-cameraPosition);
  vec2 bounds=sphere(origin,direction,topRadius);
  float start=max(0.0,bounds.x), end=bounds.y;
  vec2 ground=sphere(origin,direction,bodyRadius);
  if(ground.x>0.0)end=min(end,ground.x);
  if(end<=start)discard;
  float ds=(end-start)/float(VIEW_STEPS), dsKm=ds*kmPerUnit;
  float mu=dot(direction,sunDirection);
  float phaseR=3.0/(16.0*PI)*(1.0+mu*mu);
  vec3 g=clamp(mieAsymmetry,vec3(-0.98),vec3(0.98));
  vec3 phaseM=(1.0-g*g)/(4.0*PI*pow(max(vec3(0.001),1.0+g*g-2.0*g*mu),vec3(1.5)));
  vec3 transmission=vec3(1.0), radiance=vec3(0.0);
  for(int i=0;i<VIEW_STEPS;i++){
    vec3 p=origin+direction*(start+(float(i)+0.5)*ds);
    vec3 density=densities(p), ext=extinction(density);
    vec3 stepTrans=exp(-ext*dsKm);
    vec3 scatter=rayleigh*density.x*phaseR+mie*density.y*phaseM;
    vec3 incoming=sunTransmission(p)*3.2;
    // Low order ambient term stands in for KSA's multiple-scattering LUT.
    scatter*=incoming+vec3(0.035);
    radiance+=transmission*scatter*(1.0-stepTrans)/max(ext,vec3(1e-8));
    transmission*=stepTrans;
  }
  float alpha=clamp(1.0-dot(transmission,vec3(0.3333333)),0.0,0.98);
  if(alpha<0.0001&&max(max(radiance.r,radiance.g),radiance.b)<0.0001)discard;
  gl_FragColor=vec4(radiance/max(alpha,0.0001),alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const cloudFragment = `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec3 vWorldNormal;
uniform sampler2D cloudColor;
uniform sampler2D cloudMask;
uniform sampler2D cloudNormal;
uniform sampler2D cloudDetail;
uniform sampler2D flowMap;
uniform vec3 tint;
uniform vec3 sunDirection;
uniform float timeSeconds;
uniform float loopSeconds;
uniform float flowScale;
uniform float lambertian;
uniform float alphaOnly;
uniform float detailTiling;
uniform float cloudTypeCount;
uniform float typeOpticalDepth[8];
uniform float typeBrightness[8];
uniform float typeEdgeSharpness[8];
uniform float typeNoiseTiling[8];
uniform float noiseScrollSpeed;
vec2 spherical(vec3 n){return vec2(0.5-atan(n.z,n.x)/(2.0*PI),0.5-asin(clamp(n.y,-1.0,1.0))/PI);}
void main(){
  #include <logdepthbuf_fragment>
  vec3 normal=normalize(vLocalPosition);
  vec2 uv=spherical(normal);
  vec2 flow=(texture2D(flowMap,uv).rg*2.0-1.0)*flowScale;
  float phase=fract(timeSeconds/max(loopSeconds,0.1)+texture2D(cloudMask,uv).r*0.35);
  float phase2=fract(phase+0.5), weight=abs(phase*2.0-1.0);
  vec2 a=uv+flow*phase,b=uv+flow*phase2;
  vec4 color=mix(texture2D(cloudColor,a),texture2D(cloudColor,b),weight);
  float selector=mix(texture2D(cloudMask,a).r,texture2D(cloudMask,b).r,weight);
  vec4 detail=texture2D(cloudDetail,uv*detailTiling);
  vec2 detailSample=mix(detail.rg,detail.ba,selector);
  float cloudType=clamp(detailSample.y,0.0,1.0)*(cloudTypeCount-1.0);
  int first=int(floor(cloudType)), second=min(first+1,int(cloudTypeCount)-1);
  float typeWeight=fract(cloudType);
  float opticalDepth=mix(typeOpticalDepth[first],typeOpticalDepth[second],typeWeight);
  float brightness=mix(typeBrightness[first],typeBrightness[second],typeWeight);
  float sharpness=mix(typeEdgeSharpness[first],typeEdgeSharpness[second],typeWeight);
  float noiseTiling=mix(typeNoiseTiling[first],typeNoiseTiling[second],typeWeight);
  float noise=clamp((texture2D(cloudDetail,uv*noiseTiling+vec2(timeSeconds*noiseScrollSpeed,-timeSeconds*noiseScrollSpeed*0.37)).r-0.86)/0.14,0.0,1.0);
  float erosion=0.85+0.15*smoothstep(0.5-mix(0.2,0.01,sharpness),0.5+mix(0.2,0.01,sharpness),noise);
  vec3 relief=mix(texture2D(cloudNormal,a).xyz,texture2D(cloudNormal,b).xyz,weight)*2.0-1.0;
  vec3 N=normalize(vWorldNormal);
  // Relief slopes follow the same coverage/type map as native cloud normals.
  float light=dot(N,sunDirection);
  float reliefLight=clamp(light+(relief.x-relief.y)*0.17,0.0,1.0);
  vec3 V=normalize(cameraPosition-vWorldPosition);
  float viewCos=abs(dot(N,V));
  float silver=pow(clamp(dot(V,-sunDirection)*0.5+0.5,0.0,1.0),8.0)*(1.0-viewCos)*0.18;
  float day=smoothstep(-0.13,0.08,light);
  float selfShadow=exp(-min(opticalDepth,12.0)*(1.0-reliefLight)*0.045);
  vec3 albedo=mix(color.rgb,vec3(1.0),alphaOnly)*tint;
  vec3 radiance=albedo*(0.045+day*(mix(0.28,reliefLight,lambertian)*selfShadow*brightness+silver));
  float alpha=color.a*detailSample.x*erosion*(1.0-exp(-opticalDepth/max(viewCos,0.2)));
  if(alpha<0.012)discard;
  gl_FragColor=vec4(radiance,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function dataTexture(data: Uint8Array, width: number, height: number, color = false) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createAtmospherePreview(
  body: Planet,
  radius: number,
  detailed = true,
): THREE.Mesh | null {
  const a = body.atmosphere;
  if (!a.enabled || Math.max(...a.rayleigh, ...a.mie) * a.intensity <= 0) return null;
  const heightKm = nativeAtmosphereHeightKm(a);
  if (!(heightKm > a.startHeightKm)) return null;
  const topRadius = radius * (1 + heightKm / body.radiusKm);
  const uniforms = {
    bodyCenter: { value: new THREE.Vector3() },
    sunDirection: { value: new THREE.Vector3(-5, 3, 5).normalize() },
    bodyRadius: { value: radius },
    bottomRadius: { value: radius * (1 + a.startHeightKm / body.radiusKm) },
    topRadius: { value: topRadius },
    kmPerUnit: { value: body.radiusKm / radius },
    rayleigh: { value: new THREE.Vector3(...a.rayleigh).multiplyScalar(a.intensity) },
    mie: { value: new THREE.Vector3(...a.mie).multiplyScalar(a.intensity) },
    absorption: { value: new THREE.Vector3(...a.absorption).multiplyScalar(a.intensity) },
    rayleighHeight: { value: Math.max(0.001, a.rayleighHeightKm) },
    mieHeight: { value: Math.max(0.001, a.mieHeightKm) },
    mieAsymmetry: { value: new THREE.Vector3(...a.mieAnisotropyRgb) },
    mieAbsorption: { value: a.mieAbsorptionMultiplier },
    ozoneAltitude: { value: a.ozoneAltitudeKm },
    ozoneExtent: { value: a.ozoneExtentKm },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(topRadius, 64, 32),
    new THREE.ShaderMaterial({
      defines: { VIEW_STEPS: detailed ? 12 : 6, LIGHT_STEPS: detailed ? 4 : 3 },
      uniforms,
      vertexShader: vertex,
      fragmentShader: atmosphereFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  mesh.name = "Atmospheric scattering";
  mesh.userData.atmospherePreview = true;
  mesh.userData.bodyId = body.id;
  mesh.renderOrder = 20;
  mesh.onBeforeRender = () => mesh.getWorldPosition(uniforms.bodyCenter.value);
  return mesh;
}

function createCloudPreview(
  body: Planet,
  layer: CloudLayerSettings,
  radius: number,
  detailed: boolean,
): THREE.Mesh {
  const width = detailed ? 384 : 128,
    height = width / 2;
  const pixels = cloudPixels(body, layer, width, height);
  const bounds = cloudLayerBounds(layer);
  const profile = compileCloudProfile(layer);
  const sampleSurface = compileSurfaceSampler(body);
  // A shell is the proxy for native raymarched cloud columns. Bake the column's
  // terrain visibility into alpha, rather than letting polygon edges cut hills.
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * width + x,
        top = pixels.cloudTopKm[at];
      const direction = nativeCloudDirection((x + 0.5) / width, (y + 0.5) / height);
      const surface = sampleSurface(direction);
      const ground =
        body.kind === "rocky"
          ? (surface.height - body.surface.seaLevel) * body.surface.elevation
          : 0;
      const visibility =
        top <= bounds.bottomKm + 0.001
          ? 0
          : Math.max(0, Math.min(1, (top - ground) / Math.max(0.01, top - bounds.bottomKm)));
      pixels.color[at * 4 + 3] *= visibility;
      if (layer.matchGroundColor)
        for (let channel = 0; channel < 3; channel++)
          pixels.color[at * 4 + channel] *= surface.color[channel];
    }
  const geometry = new THREE.SphereGeometry(radius, detailed ? 128 : 48, detailed ? 64 : 24);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const direction = new THREE.Vector3().fromBufferAttribute(p, i).normalize();
    const sample = sampleCloud(body, layer, [direction.x, direction.y, direction.z]);
    const cloudTop = profile.topAltitudeKm(sample.coverage, sample.type);
    const ground =
      body.kind === "rocky"
        ? (sampleSurface([direction.x, direction.y, direction.z]).height - body.surface.seaLevel) *
          body.surface.elevation
        : 0;
    const altitude = Math.max(ground + 0.02, bounds.topKm - (bounds.topKm - cloudTop) * 0.02);
    const r = radius * (1 + altitude / body.radiusKm);
    p.setXYZ(i, direction.x * r, direction.y * r, direction.z * r);
  }
  geometry.computeVertexNormals();
  const textures = {
    cloudColor: { value: dataTexture(pixels.color, width, height, true) },
    cloudMask: { value: dataTexture(pixels.mask, width, height) },
    cloudNormal: { value: dataTexture(pixels.normal, width, height) },
    cloudDetail: { value: dataTexture(pixels.detail, 32, 32) },
    flowMap: { value: dataTexture(pixels.flow, width, height) },
  };
  textures.cloudDetail.value.wrapT = THREE.RepeatWrapping;
  textures.cloudDetail.value.generateMipmaps = true;
  textures.cloudDetail.value.minFilter = THREE.LinearMipmapLinearFilter;
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: {
        ...textures,
        tint: { value: new THREE.Color(layer.color) },
        sunDirection: { value: new THREE.Vector3(-5, 3, 5).normalize() },
        timeSeconds: { value: 0 },
        loopSeconds: { value: layer.flow.loopHours * 3600 },
        flowScale: {
          value: layer.flow.enabled ? layer.flow.displacementKm / (body.radiusKm * Math.PI * 2) : 0,
        },
        lambertian: { value: layer.lambertian },
        alphaOnly: { value: layer.useAlphaOnly ? 1 : 0 },
        detailTiling: { value: (body.radiusKm * Math.PI * 2) / layer.detailSizeKm },
        cloudTypeCount: { value: layer.types.length },
        typeBrightness: {
          value: Array.from(
            { length: 8 },
            (_, i) => layer.types[Math.min(i, layer.types.length - 1)].multipleScatteringBrightness,
          ),
        },
        typeOpticalDepth: {
          value: Array.from(
            { length: 8 },
            (_, i) => profile.opticalDepths[Math.min(i, layer.types.length - 1)],
          ),
        },
        typeEdgeSharpness: {
          value: Array.from(
            { length: 8 },
            (_, i) => layer.types[Math.min(i, layer.types.length - 1)].edgeSharpness,
          ),
        },
        typeNoiseTiling: {
          value: Array.from(
            { length: 8 },
            (_, i) =>
              (body.radiusKm * Math.PI * 2) /
              layer.types[Math.min(i, layer.types.length - 1)].noiseScaleKm,
          ),
        },
        noiseScrollSpeed: { value: layer.noiseScrollSpeed / (body.radiusKm * Math.PI * 2 * 1000) },
      },
      vertexShader: vertex,
      fragmentShader: cloudFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  mesh.name = `Clouds: ${layer.name}`;
  mesh.userData.cloudLayer = layer;
  mesh.userData.bodyId = body.id;
  mesh.userData.cloudRadiusKm = body.radiusKm + bounds.bottomKm;
  mesh.renderOrder = 5;
  return mesh;
}

export function addAtmospherePreview(
  mesh: THREE.Mesh,
  body: Planet,
  radius: number,
  detailed: boolean,
) {
  if (body.atmosphere.enabled && body.clouds.enabled) {
    for (const layer of body.clouds.layers.filter((l) => l.enabled && l.types.length)) {
      mesh.add(createCloudPreview(body, layer, radius, detailed));
    }
  }
  const atmosphere = createAtmospherePreview(body, radius, detailed);
  if (atmosphere) mesh.add(atmosphere);
}

/** Simulation seconds control weather motion; camera orbiting leaves sunlight fixed in world space. */
export function updateAtmospherePreview(root: THREE.Object3D, seconds: number) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial) {
      if (object.userData.cloudLayer) {
        const layer = object.userData.cloudLayer as CloudLayerSettings;
        const radiusM = Number(object.userData.cloudRadiusKm) * 1000;
        // Native Z is the Three preview's north (Y) axis.
        object.rotation.set(
          (layer.rotationSpeed[1] * seconds) / radiusM,
          (layer.rotationSpeed[2] * seconds) / radiusM,
          (-layer.rotationSpeed[0] * seconds) / radiusM,
        );
        object.material.uniforms.timeSeconds.value = seconds;
      }
    }
  });
}

/** Shallow-water transmission and a moving wave-normal field, inspired by native ocean inputs. */
export function createOceanPreviewMaterial(
  ocean: OceanSettings,
  alphaMap: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  const size = 128,
    data = new Uint8Array(size * size * 4);
  const speed = (ocean.windWaves.minWindSpeed + ocean.windWaves.maxWindSpeed) / 2;
  const fetch = Math.sqrt(Math.max(0.01, ocean.windWaves.maxWindFetchKm));
  const strength = Math.min(0.6, 0.05 + speed * 0.009 + fetch * 0.001);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let nx = 0,
        ny = 0;
      for (let i = 1; i <= 5; i++) {
        const u = (x / size) * Math.PI * 2,
          v = (y / size) * Math.PI * 2;
        const f = i * i,
          a = strength / (i * 1.5);
        nx += Math.cos(u * f + v * i + i) * a;
        ny += Math.sin(v * f - u * i * ocean.windWaves.directionality + i * 2) * a;
      }
      const length = Math.hypot(nx, ny, 1),
        at = (y * size + x) * 4;
      data.set(
        [
          Math.round(((nx / length) * 0.5 + 0.5) * 255),
          Math.round(((ny / length) * 0.5 + 0.5) * 255),
          Math.round(((1 / length) * 0.5 + 0.5) * 255),
          255,
        ],
        at,
      );
    }
  }
  const normalMap = dataTexture(data, size, size);
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.anisotropy = 4;
  normalMap.repeat.set(32, 16);
  const material = new THREE.MeshPhysicalMaterial({
    color: ocean.color,
    alphaMap,
    normalMap,
    normalScale: new THREE.Vector2(0.65, 0.65),
    transparent: true,
    depthWrite: false,
    roughness: Math.min(0.45, 0.08 + speed * 0.012),
    metalness: 0,
    ior: 1.333,
    specularIntensity: 1,
  });
  material.userData.oceanPreview = ocean;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.foamAmount = { value: ocean.windWaves.foamAmount };
    shader.fragmentShader = "uniform float foamAmount;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphamap_fragment>",
      `#include <alphamap_fragment>
      float shoreFoam = (1.0-smoothstep(0.15,0.92,diffuseColor.a))*smoothstep(0.01,0.12,diffuseColor.a);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.8),shoreFoam*foamAmount*0.5);`,
    );
  };
  material.customProgramCacheKey = () => "generated-ocean-foam-v1";
  return material;
}

export function updateOceanPreview(root: THREE.Object3D, seconds: number) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshPhysicalMaterial))
      return;
    const ocean = object.material.userData.oceanPreview as OceanSettings | undefined;
    if (ocean && object.material.normalMap) {
      const speed =
        (ocean.windWaves.maxWindSpeed + ocean.gerstnerWaves.speed * ocean.gerstnerWaves.count) /
        100000;
      object.material.normalMap.offset.set(seconds * speed, seconds * speed * 0.37);
    }
  });
}

export function disposePreviewMaterial(material: THREE.Material) {
  if (material instanceof THREE.ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      if (uniform.value instanceof THREE.Texture) uniform.value.dispose();
    }
  }
}
