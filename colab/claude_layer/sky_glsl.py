"""Claude layer — Sky DSL → GLSL ES transpiler (Python port of @hero/shader-dsl).

This is part of *my* domain: turning a constrained, validated SkySpec into a
real fragment shader. The spec drives which code paths are emitted (a clear sky
ships no aurora noise). Output is consumed verbatim by the standalone Three.js
runtime (colab/runtime/hero.js).
"""
from __future__ import annotations

from typing import Any, Dict, List

NOISE_GLSL = """
float hash21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float hash31(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p);
  float a=hash21(i), b=hash21(i+vec2(1.0,0.0)), c=hash21(i+vec2(0.0,1.0)), d=hash21(i+vec2(1.0,1.0));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v=0.0, amp=0.5; mat2 rot=mat2(0.8,-0.6,0.6,0.8);
  for(int i=0;i<6;i++){ v+=amp*vnoise(p); p=rot*p*2.0+17.0; amp*=0.5; }
  return v;
}
"""

ATMOSPHERE_GLSL = """
vec3 skyGradient(vec3 dir){
  float horizonBias=pow(1.0-abs(dir.y),4.0);
  vec3 col=mix(uHorizonColor,uZenithColor,smoothstep(0.0,0.6,dir.y));
  col=mix(col,uGroundColor,smoothstep(0.0,-0.15,dir.y));
  float sunAmount=max(dot(dir,normalize(uSunDir)),0.0);
  col+=uSunColor*pow(sunAmount,4.0)*0.35*uSunIntensity;
  col+=uHorizonColor*horizonBias*0.25;
  return col;
}
vec3 sunDisc(vec3 dir){
  float d=distance(dir,normalize(uSunDir));
  float core=smoothstep(uSunSize,uSunSize*0.4,d);
  float halo=pow(max(dot(dir,normalize(uSunDir)),0.0),64.0);
  return uSunColor*(core*6.0+halo*0.6)*uSunIntensity;
}
"""

CLOUDS_GLSL = """
float cloudLayer(vec3 dir){
  if(dir.y<0.02) return 0.0;
  vec2 uv=dir.xz/max(dir.y,0.08); uv*=1.4; uv+=uTime*uCloudSpeed;
  float n=fbm(uv*1.5); n+=0.5*fbm(uv*4.0+9.0); n/=1.5;
  float cover=1.0-uCloudCoverage;
  float c=smoothstep(cover,cover+0.25,n);
  c*=smoothstep(0.02,uCloudHeight,dir.y); c*=smoothstep(1.0,0.4,dir.y);
  return clamp(c,0.0,1.0);
}
"""

AURORA_GLSL = """
vec3 aurora(vec3 dir){
  if(dir.y<0.0) return vec3(0.0);
  float band=0.0; vec2 uv=vec2(atan(dir.z,dir.x)*0.5,dir.y);
  for(int i=0;i<3;i++){
    float fi=float(i);
    float speed=uTime*uAuroraSpeed*(1.0+fi*0.3);
    float ribbon=fbm(vec2(uv.x*3.0+speed,fi*5.0));
    float h=ribbon*0.4+0.35+fi*0.08;
    band+=smoothstep(0.18,0.0,abs(dir.y-h))*(0.6-fi*0.15);
  }
  band*=0.6+0.4*fbm(vec2(uv.x*8.0,uTime*uAuroraSpeed*2.0));
  return uAuroraColor*band*uAuroraIntensity;
}
"""

STARS_GLSL = """
vec3 starField(vec3 dir){
  if(dir.y<0.0) return vec3(0.0);
  vec3 cell=floor(dir*(180.0+uStarDensity*220.0));
  float rnd=hash31(cell);
  float star=step(1.0-uStarDensity*0.02,rnd);
  float tw=0.6+0.4*sin(uTime*3.0+rnd*100.0);
  return vec3(star*tw*smoothstep(0.0,0.4,dir.y));
}
"""

VERTEX = """
varying vec3 vWorldPosition;
void main(){
  vec4 wp=modelMatrix*vec4(position,1.0);
  vWorldPosition=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}
"""


def compile_sky(spec: Dict[str, Any]) -> Dict[str, Any]:
    """SkySpec dict → {vertex, fragment, uniforms, features}.

    `uniforms` maps GLSL name → value (float or [x,y,z]); the JS runtime builds
    THREE uniform objects from it generically, so the name↔value contract lives
    in exactly one place.
    """
    features = ["atmosphere"]
    uniforms: Dict[str, Any] = {
        "uSunDir": spec["sunDirection"],
        "uZenithColor": spec["zenithColor"],
        "uHorizonColor": spec["horizonColor"],
        "uGroundColor": spec["groundColor"],
        "uSunColor": spec["sunColor"],
        "uSunIntensity": spec["sunIntensity"],
        "uSunSize": spec["sunSize"],
    }
    decls: List[str] = [
        "uniform float uTime;", "uniform vec3 uSunDir;", "uniform vec3 uZenithColor;",
        "uniform vec3 uHorizonColor;", "uniform vec3 uGroundColor;", "uniform vec3 uSunColor;",
        "uniform float uSunIntensity;", "uniform float uSunSize;",
    ]
    helpers: List[str] = [NOISE_GLSL, ATMOSPHERE_GLSL]
    body: List[str] = [
        "vec3 dir=normalize(vWorldPosition-cameraPosition);",
        "vec3 col=skyGradient(dir);",
    ]

    clouds = spec.get("clouds", {})
    if clouds.get("enabled"):
        features.append("clouds")
        helpers.append(CLOUDS_GLSL)
        decls += ["uniform float uCloudCoverage;", "uniform float uCloudSpeed;",
                  "uniform float uCloudHeight;", "uniform vec3 uCloudColor;"]
        uniforms.update(uCloudCoverage=clouds["coverage"], uCloudSpeed=clouds["speed"],
                        uCloudHeight=clouds["height"], uCloudColor=clouds["color"])
        body += [
            "float clouds=cloudLayer(dir);",
            "float cloudShade=0.6+0.4*max(dot(dir,normalize(uSunDir)),0.0);",
            "col=mix(col,uCloudColor*cloudShade,clouds*0.9);",
        ]

    aurora = spec.get("aurora", {})
    if aurora.get("enabled"):
        features.append("aurora")
        helpers.append(AURORA_GLSL)
        decls += ["uniform vec3 uAuroraColor;", "uniform float uAuroraIntensity;", "uniform float uAuroraSpeed;"]
        uniforms.update(uAuroraColor=aurora["color"], uAuroraIntensity=aurora["intensity"], uAuroraSpeed=aurora["speed"])
        body.append("col+=aurora(dir);")

    stars = spec.get("stars", {})
    if stars.get("enabled"):
        features.append("stars")
        helpers.append(STARS_GLSL)
        decls.append("uniform float uStarDensity;")
        uniforms["uStarDensity"] = stars["density"]
        body.append("col+=starField(dir);")

    body += ["col+=sunDisc(dir);", "gl_FragColor=vec4(col,1.0);"]

    fragment = "\n".join(
        ["precision highp float;", "varying vec3 vWorldPosition;", *decls, *helpers,
         "void main(){", *["  " + b for b in body], "}"]
    )
    # uTime is set every frame by the runtime; include it so the JS builds it
    uniforms_with_time = {"uTime": 0.0, **uniforms}
    return {"vertex": VERTEX, "fragment": fragment, "uniforms": uniforms_with_time, "features": features}
