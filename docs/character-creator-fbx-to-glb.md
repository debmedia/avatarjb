# Character Creator FBX to GLB pipeline

Objetivo: convertir `avatar1_0.Fbx` + `avatar1_0.json` en un `avatar1_0.glb` usable desde Three.js, preservando skeleton, materiales y shape keys/morph targets.

## Estado de los archivos

- `avatar1_0.Fbx`: fuente principal. Pesa alrededor de 492 MB e incluye meshes, rig y datos faciales.
- `avatar1_0.json`: metadata de Character Creator. Sirve como referencia de materiales/shaders, pero Three.js consume el `.glb`.
- Blender no esta instalado en este entorno, asi que la conversion debe ejecutarse en una maquina con Blender.

## Conversion con Blender

Instalar Blender 4.x y ejecutar desde esta carpeta:

```bash
blender --background --python scripts/convert-fbx-to-glb.py -- \
  --fbx avatar1_0.Fbx \
  --out public/avatar1_0.glb \
  --report public/avatar1_0.morph-report.json
```

El script:

- importa el FBX,
- busca imagenes/texturas cercanas,
- exporta GLB con `Shape Keys`, `Skinning`, `Materials` y texturas,
- genera `public/avatar1_0.morph-report.json` con meshes, bones, materiales y shape keys.

Si Blender falla por memoria, cerrar apps pesadas y repetir. El FBX es grande; conviene tener varios GB libres de RAM.

## Validacion en Blender

Despues de importar:

1. Seleccionar la cabeza/cuerpo facial, normalmente `CC_Base_Body`.
2. Ir a `Object Data Properties -> Shape Keys`.
3. Confirmar que hay shape keys de boca, ojos y expresiones.
4. Confirmar que existe armature con huesos como `CC_Base_JawRoot`, `CC_Base_L_Eye`, `CC_Base_R_Eye`, lengua y dientes.

Si no hay shape keys, el FBX fue exportado sin morphs. En Character Creator hay que reexportar incluyendo blendshapes/expression morphs.

## Inspeccion del GLB

Abrir:

```text
tools/glb-morph-inspector.html
```

Cargar `public/avatar1_0.glb`. El inspector muestra:

- meshes,
- `morphTargetDictionary`,
- materiales,
- bones.

Ese reporte define los nombres reales que hay que usar para lip sync y Audio2Face.

## Version liviana cabeza/torso

Para pruebas en browser conviene exportar una version recortada. Ocultar la parte baja en Three.js no ahorra memoria: el GLB ya se descargo y la geometria/texturas ya estan cargadas. Para ahorrar recursos hay que exportar menos geometria desde Blender.

Comando:

```bash
blender --background --python scripts/convert-fbx-to-glb.py -- \
  --fbx avatar1_0.Fbx \
  --out public/avatar1_0_upper.glb \
  --report public/avatar1_0_upper.morph-report.json \
  --upper-body
```

El modo `--upper-body`:

- elimina `Sport_Sneakers`, `Slim_Fit_Trousers`, `Sphere01` y `default`,
- recorta vertices bajo un corte relativo de altura,
- conserva shape keys/morph targets de cabeza/cara,
- exporta un GLB mas razonable para pruebas web.

Si el corte queda muy alto o muy bajo, ajustar:

```bash
--cut-ratio 0.44
```

Valores menores cortan mas abajo; valores mayores cortan mas arriba.

## Three.js

Ejemplo base:

```js
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const gltf = await new GLTFLoader().loadAsync("/avatar1_0.glb");
scene.add(gltf.scene);

const morphMeshes = [];
gltf.scene.traverse((node) => {
  if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
    morphMeshes.push(node);
  }
});

function setMorph(mesh, name, value) {
  const index = mesh.morphTargetDictionary[name];
  if (index === undefined) return false;
  mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, value));
  return true;
}
```

## Mapping de Audio2Face / lip sync

Usar `avatar1_0.morph-map.example.json` como base. Despues de exportar, reemplazar los candidatos por nombres exactos del `morph-report`.

Ejemplo:

```js
const map = {
  jawOpen: "V_Open",
  eyeBlinkLeft: "Eye_Blink_L",
  eyeBlinkRight: "Eye_Blink_R",
  mouthSmileLeft: "Mouth_Smile_L",
  mouthSmileRight: "Mouth_Smile_R"
};

function applyAudio2FaceFrame(mesh, frame) {
  for (const [channel, morphName] of Object.entries(map)) {
    setMorph(mesh, morphName, frame[channel] ?? 0);
  }
}
```

Para Gemini Live sin visemas, el fallback actual es energia de audio. Eso puede abrir/cerrar boca, pero no genera fonemas reales. Para sincronizacion buena hacen falta visemas o salida tipo Audio2Face/ARKit.

## Criterio de exito

El GLB esta listo cuando:

- carga en Three.js sin errores,
- al menos un mesh tiene `morphTargetDictionary`,
- se puede mover una shape key de boca con `morphTargetInfluences`,
- parpadeo y jaw/mouth responden con valores entre `0` y `1`,
- materiales/texturas se ven aceptables en browser.
