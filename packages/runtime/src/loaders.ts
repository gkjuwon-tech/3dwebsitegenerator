import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export interface LoaderPaths {
  /** directory serving draco_decoder.js / .wasm */
  draco?: string;
  /** directory serving the basis_transcoder for KTX2 */
  basis?: string;
}

/**
 * GLTFLoader wired for the optimized delivery format the pipeline targets:
 * Draco-compressed geometry, KTX2/Basis textures, meshopt. Decoder assets are
 * served locally (copied into the app's public/ dir) so nothing depends on a
 * third-party CDN at runtime.
 */
export function createGLTFLoader(renderer: THREE.WebGLRenderer, paths: LoaderPaths = {}): GLTFLoader {
  const loader = new GLTFLoader();

  const draco = new DRACOLoader();
  draco.setDecoderPath(paths.draco ?? '/decoders/draco/');
  loader.setDRACOLoader(draco);

  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(paths.basis ?? '/decoders/basis/');
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);

  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** Load a GLB and return its root, with shadow flags set on every mesh. */
export async function loadGLB(loader: GLTFLoader, url: string): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return gltf.scene;
}
