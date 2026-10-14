"""Procedural original geometry for the 17 Orbit Foundry stock additions.

The builders use only Blender's bundled Python API and the shared ``Shape``
accumulator.  Atlas colors, names, descriptions, and renderer metadata are read
from ``stock_expansion_manifest.json`` so this module does not fork that source
of truth.  Each builder returns ``(shape, details)`` and accepts ``lod_level``;
tree builders also accept ``foliage_density`` for structural LOD staging.
"""
import importlib.util
import json
import math
import random
import sys
from pathlib import Path

from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = Path(__file__).with_name("stock_expansion_manifest.json")


def _geometry_module():
    module = sys.modules.get("stock_geometry")
    if module is not None:
        return module
    path = Path(__file__).with_name("stock_geometry.py")
    spec = importlib.util.spec_from_file_location("stock_geometry", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["stock_geometry"] = module
    spec.loader.exec_module(module)
    return module


_g = _geometry_module()
Shape = _g.Shape
TAU = math.tau
Z = Vector((0.0, 0.0, 1.0))


def _v(value):
    return value.copy() if isinstance(value, Vector) else Vector(value)


def _unit(value, fallback=(0.0, 0.0, 1.0)):
    value = _v(value)
    return value.normalized() if value.length > 1e-8 else Vector(fallback)


def _thin_profile(path, radii, count):
    if len(path) <= count:
        return list(path), list(radii)
    picks = sorted({round(i * (len(path) - 1) / (count - 1)) for i in range(count)})
    return [path[i] for i in picks], [radii[i] for i in picks]


def _catmull_rom(points, samples_per_segment=4):
    points = [_v(point) for point in points]
    output = []
    for segment in range(len(points) - 1):
        p0 = points[max(0, segment - 1)]
        p1, p2 = points[segment], points[segment + 1]
        p3 = points[min(len(points) - 1, segment + 2)]
        for step in range(samples_per_segment):
            t = step / samples_per_segment
            t2, t3 = t * t, t * t * t
            point = (2 * p1 + (-p0 + p2) * t
                     + (2*p0 - 5*p1 + 4*p2 - p3) * t2
                     + (-p0 + 3*p1 - 3*p2 + p3) * t3) * 0.5
            output.append(tuple(point))
    output.append(tuple(points[-1]))
    return output


def _path_point(path, t):
    path = [_v(point) for point in path]
    at = min(len(path) - 1.000001, max(0.0, t * (len(path) - 1)))
    index = int(at)
    return path[index].lerp(path[index + 1], at - index)


def _branch(start, direction, length, rise=0.12, sway=0.0, samples=5, side=None):
    start, direction = _v(start), _unit(direction)
    side = _v(side) if side is not None else Vector((-direction.y, direction.x, 0.0))
    if side.length < 1e-7:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    end = start + direction * length + Z * (length * rise) + side * sway
    p1 = start + direction * (length * 0.29) + Z * (length * rise * 0.74) + side * (sway * 0.15)
    p2 = start + direction * (length * 0.73) + Z * (length * rise * 0.90) + side * (sway * 0.74)
    return _g._sample_cubic(start, p1, p2, end, samples)


def _wood(shape, path, radii, lod_level=0, slot=0, sides=7, smooth=True):
    path, radii = list(path), list(radii)
    if len(path) != len(radii):
        old = radii
        radii = []
        for index in range(len(path)):
            at = index * (len(old)-1) / max(1, len(path)-1)
            lo = int(at); hi = min(len(old)-1, lo+1); mix = at-lo
            radii.append(old[lo]*(1-mix)+old[hi]*mix)
    if lod_level >= 3:
        path, radii = _thin_profile(path, radii, 3)
    elif lod_level == 2:
        path, radii = _thin_profile(path, radii, 4)
    if isinstance(sides, (tuple, list)):
        sides = sides[lod_level]
    else:
        sides = max(3, sides - max(0, lod_level - 1))
    shape.tube(path, radii, slot=slot, sides=sides, smooth=smooth)


def _orient_triangles(vertices, faces, center=(0.0, 0.0, 0.0)):
    center = _v(center)
    output = []
    for face in faces:
        if len(face) >= 3:
            a, b, c = (_v(vertices[face[i]]) for i in range(3))
            if (b-a).cross(c-a).dot((a+b+c)/3.0-center) < 0:
                face = tuple(reversed(face))
        output.append(tuple(face))
    return output


def _icosphere_data(subdivisions=2):
    phi = (1.0 + math.sqrt(5.0)) * 0.5
    vertices = [(-1,phi,0),(1,phi,0),(-1,-phi,0),(1,-phi,0),
                (0,-1,phi),(0,1,phi),(0,-1,-phi),(0,1,-phi),
                (phi,0,-1),(phi,0,1),(-phi,0,-1),(-phi,0,1)]
    vertices = [tuple(_v(p).normalized()) for p in vertices]
    faces = [(0,11,5),(0,5,1),(0,1,7),(0,7,10),(0,10,11),
             (1,5,9),(5,11,4),(11,10,2),(10,7,6),(7,1,8),
             (3,9,4),(3,4,2),(3,2,6),(3,6,8),(3,8,9),
             (4,9,5),(2,4,11),(6,2,10),(8,6,7),(9,8,1)]
    for _ in range(max(0, int(subdivisions))):
        cache = {}
        def midpoint(a, b):
            edge = tuple(sorted((a, b)))
            if edge not in cache:
                cache[edge] = len(vertices)
                vertices.append(tuple((_v(vertices[a]) + _v(vertices[b])).normalized()))
            return cache[edge]
        refined = []
        for a, b, c in faces:
            ab, bc, ca = midpoint(a,b), midpoint(b,c), midpoint(c,a)
            refined.extend(((a,ab,ca),(b,bc,ab),(c,ca,bc),(ab,bc,ca)))
        faces = refined
    return vertices, faces


def _surface_slot(normal, point, style="stone"):
    n, p = _unit(normal), _v(point)
    # Broad coherent mineral patches: use low-frequency positional bands rather
    # than per-triangle random colors, which can read as confetti.
    field = (0.48 * math.sin(p.x * 2.3 + p.y * 1.1)
             + 0.36 * math.cos(p.y * 2.0 - p.z * 0.8)
             + 0.24 * n.z)
    if style == "lava":
        return 1 if field < -0.35 else 2 if field < 0.35 else 3 if field < 0.80 else 5
    if style == "sand":
        return 1 + min(3, max(0, int((p.z + 0.2) * 2.4)))
    if style == "ice":
        return 1 + min(3, max(0, int((n.z + 1.0) * 1.8)))
    return 1 if field < -0.45 else 2 if field < 0.1 else 3 if field < 0.7 else 4


def _rock_component(shape, center, radii, subdivisions=2, seed=0, style="stone",
                    smooth=False, pits=0, roughness=0.06, base_z=0.02):
    rng = random.Random(seed)
    unit_vertices, faces = _icosphere_data(subdivisions)
    pit_dirs = [_unit((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
                for _ in range(pits)]
    vertices = []
    for i, unit in enumerate(unit_vertices):
        direction = _v(unit)
        modulation = (roughness * math.sin(direction.x * 8.1 + seed * 0.17)
                      * math.sin(direction.y * 6.7 - seed * 0.11)
                      + roughness * 0.55 * math.cos(direction.z * 11.0 + direction.x * 5.0))
        if len(unit_vertices) > 200:
            modulation += rng.uniform(-roughness * 0.34, roughness * 0.34)
        for pit_direction in pit_dirs:
            cosine = max(-1.0, min(1.0, direction.dot(pit_direction)))
            angle = math.acos(cosine)
            radius_angle = rng.uniform(0.085, 0.15)
            if angle < radius_angle * 1.5:
                depression = -0.12 * math.exp(-((angle / radius_angle) ** 2) * 2.2)
                lip = 0.032 * math.exp(-(((angle - radius_angle * 1.18) / (radius_angle * 0.24)) ** 2))
                modulation += depression + lip
        radial = direction * (1.0 + modulation)
        point = _v(center) + Vector((radial.x * radii[0], radial.y * radii[1], radial.z * radii[2]))
        vertices.append(tuple(point))
    # Float the component just enough that its lowest point rests on the floor.
    minimum_z = min(point[2] for point in vertices)
    shift = base_z - minimum_z
    vertices = [(x, y, z + shift) for x, y, z in vertices]
    faces = _orient_triangles(vertices, faces, center=(center[0], center[1], center[2] + shift))
    slots = []
    for face in faces:
        centroid = sum((_v(vertices[index]) for index in face), Vector()) / len(face)
        a, b, c = (_v(vertices[face[i]]) for i in range(3))
        normal = (b-a).cross(c-a).normalized()
        slots.append(_surface_slot(normal, centroid, style))
    shape.add_component(vertices, faces, slots, smooth=smooth)
    return len(faces)


def _bounds_z(shape):
    return min(v[2] for v in shape.vertices), max(v[2] for v in shape.vertices)


def _curved_blade(shape, base, tip, width, thickness, slot=2, segments=4,
                  bend=(0.0, 0.0, 0.0), width_profile=None, slot_fn=None):
    """Closed, ridged blade with U across its width and V from base to tip."""
    base, tip = _v(base), _v(tip)
    axis = tip - base
    if axis.length < 1e-7:
        return
    axis.normalize()
    reference = Vector((0.0, 0.0, 1.0))
    if abs(axis.dot(reference)) > 0.92:
        reference = Vector((0.0, 1.0, 0.0))
    across = axis.cross(reference).normalized()
    depth = axis.cross(across).normalized()
    bend = _v(bend)
    if width_profile is None:
        width_profile = ((0.0, 0.25), (0.22, 0.82), (0.50, 1.0), (0.79, 0.68), (1.0, 0.035))
    def width_factor(t):
        for (t0, w0), (t1, w1) in zip(width_profile, width_profile[1:]):
            if t <= t1:
                f = (t-t0) / max(1e-8, t1-t0)
                return w0 * (1-f) + w1*f
        return width_profile[-1][1]
    segments = max(1, int(segments))
    vertices, ring_uv = [], []
    for i in range(segments + 1):
        t = i / segments
        center = base.lerp(tip, t) + bend * math.sin(math.pi*t)
        half_w = float(width) * width_factor(t) * 0.5
        half_d = max(0.0012, float(thickness) * math.sin(math.pi*t) ** 0.45 * 0.5)
        ring = (center + across * half_w, center + depth * half_d,
                center - across * half_w, center - depth * half_d)
        vertices.extend(tuple(p) for p in ring)
        ring_uv.extend(((1.0,t),(.5,t),(0.0,t),(.5,t)))
    faces, uv_faces, slots = [], [], []
    for i in range(segments):
        for side in range(4):
            a = i*4+side; b = i*4+(side+1)%4
            c = (i+1)*4+(side+1)%4; d = (i+1)*4+side
            faces.append((a,b,c,d))
            uv_faces.append((ring_uv[a],ring_uv[b],ring_uv[c],ring_uv[d]))
            slots.append(int(slot_fn((i+0.5)/segments) if slot_fn else slot))
    faces.append(tuple(reversed(range(4))))
    # Cap maps use a radial diamond instead of collapsing the whole end ring
    # onto a single atlas row.
    uv_faces.append(((.5,0.0),(0.0,.5),(.5,1.0),(1.0,.5)))
    slots.append(int(slot))
    last = segments*4
    faces.append(tuple(last+i for i in range(4)))
    uv_faces.append(((1.0,.5),(.5,1.0),(0.0,.5),(.5,0.0)))
    slots.append(int(slot_fn(1.0) if slot_fn else slot))
    shape.add_component(vertices, faces, slots, smooth=False, uv_faces=uv_faces)


def _keep_index(index, density):
    density = max(0.005, min(1.0, float(density)))
    period = max(1, round(1.0 / density))
    return index % period == 0


# ---------------------------------------------------------------------------
# Geological specimens

def build_river_boulder(seed=4101, lod_level=0):
    lod_level = max(0, min(4, int(lod_level)))
    shape = Shape()
    subdivision = (4, 3, 2, 1, 0)[lod_level]
    main = _rock_component(shape, (0.0, 0.0, 0.40), (0.40, 0.35, 0.40),
                           subdivisions=subdivision, seed=seed, smooth=True,
                           roughness=0.032, base_z=0.018)
    if lod_level <= 2:
        for index, (center, radii) in enumerate([
            ((-0.25, -0.20, 0.17), (0.20, 0.16, 0.14)),
            ((0.24, 0.13, 0.14), (0.16, 0.13, 0.11)),
        ]):
            _rock_component(shape, center, radii, subdivisions=max(1, subdivision-2),
                            seed=seed+31+index, smooth=True, roughness=0.022, base_z=0.02)
    return shape, {"main_surface_triangles": main, "submerged_pebbles": 2 if lod_level <= 2 else 0,
                   "lod_level": lod_level, "water_worn": True}


def build_talus_cluster(seed=4103, lod_level=0):
    lod_level = max(0, min(4, int(lod_level)))
    shape = Shape(); rng = random.Random(seed)
    boulders = [
        ((-0.61,-0.28,0.34),(0.48,0.52,0.42)), ((0.05,-0.32,0.53),(0.51,0.48,0.68)),
        ((0.63,-0.16,0.32),(0.43,0.49,0.39)), ((-0.30,0.38,0.74),(0.49,0.47,0.91)),
        ((0.38,0.43,0.46),(0.53,0.48,0.57)), ((-0.83,0.47,0.28),(0.35,0.39,0.33)),
        ((0.87,0.43,0.27),(0.35,0.39,0.31)), ((0.01,0.80,0.26),(0.40,0.39,0.28)),
    ]
    sub = (3,2,2,1,0)[lod_level]
    total = 0
    keep_period = (1,1,1,2,4)[lod_level]
    for index, (center, radii) in enumerate(boulders):
        if index % keep_period:
            continue
        perturb = tuple(r * rng.uniform(0.92,1.08) for r in radii)
        total += _rock_component(shape, center, perturb, sub, seed+index*29,
                                 smooth=False, roughness=0.07, base_z=0.018)
    if lod_level <= 1:
        for index in range(16):
            angle = TAU * index/16 + rng.uniform(-0.13,0.13)
            radius = rng.uniform(0.06,0.14)
            center = (1.02*math.cos(angle), 0.94*math.sin(angle), 0.06+radius*0.64)
            total += _rock_component(shape, center, (radius*1.2,radius,radius*0.7), 1,
                                     seed+400+index, smooth=False, roughness=0.09, base_z=0.012)
    return shape, {"boulder_count": 8 if lod_level < 3 else 4 if lod_level == 3 else 2,
                   "talus_chips": 16 if lod_level <= 1 else 0, "triangle_count": total,
                   "lod_level": lod_level}


def _arch_radii(path, rng):
    radii = []
    for index, point in enumerate(path):
        t = index/max(1,len(path)-1)
        taper = 0.82 + 0.12*math.cos((t-0.5)*math.pi*2)
        wobble = 1.0 + 0.04*math.sin(index*1.7) + rng.uniform(-0.02,0.02)
        radii.append(0.60*taper*wobble)
    return radii


def build_desert_arch(seed=4109, lod_level=0):
    lod_level = max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    controls=[(-2.25,0.0,0.55),(-2.42,0.03,1.28),(-2.42,0.02,2.68),(-2.08,0.04,3.95),
              (-1.43,0.05,4.78),(-0.48,0.06,5.25),(0.63,0.07,5.30),(1.56,0.04,4.87),
              (2.17,0.02,4.05),(2.33,-0.01,2.90),(2.21,-0.03,1.48),(2.04,-0.04,0.55)]
    path=_catmull_rom(controls,(8,6,5,3,2)[lod_level])
    radii=_arch_radii(path,rng)
    _wood(shape,path,radii,lod_level=lod_level,slot=2,sides=(18,16,12,10,8),smooth=False)
    if lod_level <= 2:
        # A few incised cracks interrupt the weathered outside surface.
        for crack_index, position in enumerate((0.18,0.36,0.65,0.82)):
            if lod_level == 2 and crack_index % 2: continue
            center=_path_point(path,position)
            tangent=(_path_point(path,min(.99,position+.015))-_path_point(path,max(.01,position-.015))).normalized()
            across=Vector((-tangent.z,0.0,tangent.x)).normalized()
            crack=[center + across*offset + Vector((0,-0.69,0)) for offset in (-.11,-.04,.04,.10)]
            shape.tube(crack,[.018,.014,.012,.004],slot=0,sides=4,smooth=False)
    return shape,{"open_span_m":4.1,"arch_height_m":5.84,"path_samples":len(path),"lod_level":lod_level}


def build_lava_pebble(seed=4117, lod_level=0):
    lod_level=max(0,min(4,int(lod_level))); shape=Shape()
    sub=(4,3,3,2,1)[lod_level]
    triangles=_rock_component(shape,(0,0,.15),(.16,.145,.15),subdivisions=sub,
                              seed=seed,style="lava",smooth=False,pits=(28 if lod_level<=1 else 13 if lod_level<=2 else 4),
                              roughness=.035,base_z=.012)
    # Broken, raised rims around a few real depressions give the porous body a
    # vesicular silhouette without placing loose spheres on its surface.
    if lod_level==0:
        rng=random.Random(seed+9)
        for i in range(9):
            angle=TAU*i/9+rng.uniform(-.17,.17)
            z=rng.uniform(.055,.24)
            direction=Vector((math.cos(angle),math.sin(angle),rng.uniform(-.35,.5))).normalized()
            base=Vector((direction.x*.12,direction.y*.11,z))
            tip=base+direction*rng.uniform(.025,.052)
            shape.cone(base,tip,rng.uniform(.018,.029),slot=4 if i%3 else 6,sides=5,rings=2,smooth=False)
    return shape,{"vesicle_count":28 if lod_level<=1 else 13 if lod_level<=2 else 4,
                  "body_triangles":triangles,"lod_level":lod_level}


# ---------------------------------------------------------------------------
# Earth trees.  Broad branch scaffolds remain visible at every structural LOD;
# alpha cards are sampled evenly and widened as their density falls.

def _leaflet_slot(height, low, high):
    return 1 + min(3, max(0, int((height-low) / max(1e-6, high-low) * 3.99)))


def _add_conifer_sprays(shape, path, stations, rng, card_state, density,
                        length_range, width_range, slot, lod_level, crossed=2,
                        size_scale=1.0):
    """Add paired alpha-cutout shoots along woody branches."""
    density = max(0.01, min(1.0, density))
    made = 0
    for station_index, t in enumerate(stations):
        anchor = _path_point(path, t)
        segment = min(len(path)-2, max(0, int(t*(len(path)-1))))
        tangent = (_v(path[segment+1])-_v(path[segment])).normalized()
        side = Vector((-tangent.y, tangent.x, 0.0))
        if side.length < 1e-6: side = Vector((1.0,0.0,0.0))
        side.normalize()
        tilt = rng.uniform(-0.38,0.48)
        radial = side*math.cos(tilt) + Z*math.sin(tilt)
        axis = _unit(tangent*rng.uniform(.38,.60) + radial*rng.uniform(.44,.70) + Z*rng.uniform(.12,.32))
        length = rng.uniform(*length_range) * size_scale
        width = rng.uniform(*width_range) * size_scale / math.sqrt(density)
        base = anchor + radial*rng.uniform(.025,.11) + tangent*rng.uniform(-.05,.05)
        tip = base + axis*length + radial*rng.uniform(-.03,.08)
        index = card_state[0]; card_state[0] += 1
        keep = _keep_index(index, density)
        if keep:
            sections = 3 if lod_level <= 1 else 2 if lod_level <= 3 else 1
            shape.sprig_card(base,tip,width,slot,roll=rng.uniform(-.35,.35),
                             curve=rng.uniform(.025,.10),sections=sections)
            if crossed > 1:
                shape.sprig_card(base,tip,width,slot,roll=math.pi*.5+rng.uniform(-.25,.25),
                                 curve=rng.uniform(.02,.08),sections=sections)
            made += crossed
    return made


def build_giant_redwood(seed=4201, foliage_density=None, lod_level=0):
    """Forty-metre redwood with buttressed roots, layered boughs and leader."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    if foliage_density is None: foliage_density=(1.0,.72,.46,.24,.09)[lod_level]
    density=max(.02,min(1.0,float(foliage_density)))
    trunk_controls=[(0.0,0.0,.02),(.04,0.0,7.0),(.14,.02,15.0),(.12,.09,24.0),(-.04,.17,33.0),(-.19,.22,39.85)]
    trunk_path=_catmull_rom(trunk_controls,6 if lod_level<3 else 3)
    trunk_radii=[max(.075,1.12*(1.0-p[2]/43.0)**1.08) for p in trunk_path]
    _wood(shape,trunk_path,trunk_radii,lod_level,slot=0,sides=18,smooth=True)
    roots_kept=0
    for ri in range(10):
        angle=TAU*ri/10+rng.uniform(-.15,.15); direction=Vector((math.cos(angle),math.sin(angle),0))
        tangent=Vector((-direction.y,direction.x,0)); length=rng.uniform(1.7,2.45)
        root=[(direction.x*.06,direction.y*.06,.62),
              tuple(direction*(length*.30)+tangent*rng.uniform(-.08,.08)+Vector((0,0,.42))),
              tuple(direction*(length*.66)+tangent*rng.uniform(-.12,.12)+Vector((0,0,.24))),
              tuple(direction*length+tangent*rng.uniform(-.15,.15)+Vector((0,0,.06)))]
        if lod_level<=1 or (lod_level==2 and ri%2==0) or (lod_level==3 and ri%4==0):
            _wood(shape,root,[.34,.25,.12,.018],lod_level,slot=0,sides=9,smooth=True); roots_kept+=1

    cards=[0]; card_count=0; primary_count=0; secondary_count=0
    heights=(13.0,16.4,19.8,23.2,26.5,29.6,32.5,35.1,37.3)
    branch_period=(1,1,2,3,5)[lod_level]
    secondary_period=(1,1,1,2,99)[lod_level]
    primary_paths=[]
    for level,height in enumerate(heights):
        count=7 if level<6 else 6
        phase=level*1.08+.41
        trunk_point=_path_point(trunk_path,height/39.85)
        for bi in range(count):
            angle=phase+TAU*bi/count+rng.uniform(-.14,.14)
            outward=Vector((math.cos(angle),math.sin(angle),0.0))
            length=(39.6-height)*.245+rng.uniform(.28,.63)
            start=_v(trunk_point)+outward*.28
            branch_path=_branch(start,outward,length,rise=rng.uniform(-.03,.13),
                                sway=rng.uniform(-.33,.33),samples=5 if lod_level<3 else 3)
            radius=.17*(1.0-level/12.0)*rng.uniform(.85,1.12)
            keep_branch=(bi+level)%branch_period==0
            if keep_branch:
                _wood(shape,branch_path,[radius,radius*.76,radius*.53,radius*.30,.013],lod_level,
                      slot=0,sides=7,smooth=True); primary_count+=1
            primary_paths.append((branch_path,outward,length,radius,level,angle,keep_branch))
            # These stations clothe the branch's outer shell while leaving the
            # inner trunk and lower bole uncovered.
            close_stations = (.34,.50,.66,.82,.96) if lod_level <= 2 else (.48,.68,.87,.98)
            card_count+=_add_conifer_sprays(shape,branch_path,close_stations,rng,cards,density,
                                             (.55,1.05),(.60,1.15),_leaflet_slot(height,13,40),lod_level,
                                             size_scale=1.92 if lod_level <= 2 else 1.0)

    for path,outward,length,radius,level,angle,keep_primary in primary_paths:
        for fork in range(2):
            t=.38+fork*.32+rng.uniform(-.04,.04); start=_path_point(path,t)
            side=Vector((-outward.y,outward.x,0.0))*(-1 if fork==0 else 1)
            direction=_unit(outward*.61+side*.69+Z*rng.uniform(.02,.24))
            branch_length=length*rng.uniform(.24,.36)
            secondary=_branch(start,direction,branch_length,rise=.15,sway=rng.uniform(-.12,.12),
                              samples=4 if lod_level<3 else 3)
            retain=(lod_level<=2 and (fork+int(angle*3))%secondary_period==0 and keep_primary)
            if retain:
                rr=radius*.42
                _wood(shape,secondary,[rr,rr*.68,rr*.36,.008],lod_level,slot=0,sides=5,smooth=True)
                secondary_count+=1
            close_stations = (.20,.36,.52,.68,.84,.98) if lod_level <= 2 else (.25,.52,.78,.96)
            card_count+=_add_conifer_sprays(shape,secondary,close_stations,rng,cards,density,
                                             (.40,.77),(.43,.84),_leaflet_slot(13+level*3.0,13,40),lod_level,
                                             size_scale=1.86 if lod_level <= 2 else 1.0)

    # Curved crown leader carries a handful of small sprays all the way to the
    # actual tip; no dead bare pole protrudes above the crown.
    leader=[tuple(_path_point(trunk_path,.88)),tuple(_path_point(trunk_path,.93)),
            tuple(_path_point(trunk_path,.975)),tuple(_path_point(trunk_path,1.0))]
    leader_radii=[.095,.064,.032,.006]
    if lod_level<4: _wood(shape,leader,leader_radii,lod_level,slot=0,sides=7,smooth=True)
    leader_stations = (.10,.25,.40,.55,.70,.85,.98) if lod_level <= 2 else (.16,.34,.52,.70,.87,.98)
    card_count+=_add_conifer_sprays(shape,leader,leader_stations,rng,cards,density,
                                     (.46,.82),(.42,.76),4,lod_level,
                                     size_scale=1.52 if lod_level <= 2 else 1.0)
    return shape,{"height_m":40.0,"primary_branches":primary_count,"secondary_branches":secondary_count,
                  "buttress_roots":roots_kept,"sprig_cards":card_count,"sprig_candidates":cards[0],
                  "foliage_density":density,"lod_level":lod_level}


def build_dwarf_juniper(seed=4211, foliage_density=None, lod_level=0):
    """Low blue-green juniper with crooked basal stems and a dense cushion."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    if foliage_density is None: foliage_density=(1.0,.72,.50,.30,.12)[lod_level]
    density=max(.02,min(1.0,float(foliage_density)))
    stem=[(0,0,.04),(.025,-.02,.18),(-.04,.01,.34),(.06,.04,.48)]
    _wood(shape,stem,[.14,.12,.08,.035],lod_level,slot=0,sides=9,smooth=True)
    primaries=32; branch_period=(1,1,2,3,6)[lod_level]; card_state=[0]; card_count=0; woody=0
    records=[]
    for i in range(primaries):
        angle=TAU*i/primaries+rng.uniform(-.20,.20)
        direction=Vector((math.cos(angle),math.sin(angle),0))
        level=i%4; z=.16+level*.09+rng.uniform(-.03,.035)
        start=Vector((.04*math.sin(angle*2),.035*math.cos(angle*3),z))
        length=rng.uniform(.82,1.38)*(1.0-.035*level)
        rise=rng.uniform(.55,.95); sway=rng.uniform(-.24,.24)
        path=_branch(start,direction,length,rise=rise,sway=sway,samples=6 if lod_level<3 else 3)
        radius=rng.uniform(.038,.062)
        keep=(i%branch_period==0)
        if keep:
            _wood(shape,path,[radius,radius*.76,radius*.52,radius*.27,.004],lod_level,slot=0,sides=5,smooth=True); woody+=1
        records.append((path,direction,length,radius,i,keep))
        card_count+=_add_conifer_sprays(shape,path,(.25,.43,.62,.79,.94),rng,card_state,density,
                                         (.22,.42),(.22,.39),1+(i%4),lod_level)
    for path,direction,length,radius,i,keep in records:
        for fork in range(3):
            t=.30+.22*fork; start=_path_point(path,t)
            side=Vector((-direction.y,direction.x,0))*(-1 if fork%2==0 else 1)
            axis=_unit(direction*.60+side*.62+Z*rng.uniform(-.05,.22))
            branch_length=length*rng.uniform(.26,.38)
            twig=_branch(start,axis,branch_length,rise=.12,sway=rng.uniform(-.07,.07),samples=4 if lod_level<3 else 2)
            if lod_level<=2 and keep:
                _wood(shape,twig,[radius*.48,radius*.30,.003],lod_level,slot=0,sides=4,smooth=True); woody+=1
            card_count+=_add_conifer_sprays(shape,twig,(.20,.46,.72,.94),rng,card_state,density,
                                             (.18,.34),(.18,.29),1+(i%4),lod_level)
    return shape,{"height_m":1.8,"primary_branches":woody,"sprig_cards":card_count,
                  "sprig_candidates":card_state[0],"foliage_density":density,"lod_level":lod_level}


def build_silver_birch(seed=4217, foliage_density=None, lod_level=0):
    """Forked white birch with a light crown of serrated single-leaf cards."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    if foliage_density is None: foliage_density=(1.0,.72,.48,.27,.10)[lod_level]
    density=max(.02,min(1.0,float(foliage_density)))
    trunk_paths=[]
    for trunk_index,(base_x,base_y,height,lean) in enumerate(((-.12,0,13.8,-.55),(.14,.04,12.2,.62))):
        controls=[(base_x,base_y,.02),(base_x*.7,base_y+.04,3.4),(base_x+lean*.24,base_y+.06,7.1),
                  (base_x+lean*.60,base_y+.10,10.5),(base_x+lean,base_y+.15,height)]
        path=_catmull_rom(controls,5 if lod_level<3 else 3)
        radii=[max(.035,.24*(1.0-p[2]/(height*1.32))) for p in path]
        _wood(shape,path,radii,lod_level,slot=0,sides=10,smooth=True)
        trunk_paths.append((path,height,lean,trunk_index))
    card_state=[0]; leaf_count=0; branches=0
    heights=(6.0,7.4,8.8,10.2,11.7,12.8)
    branch_period=(1,1,2,3,5)[lod_level]
    for trunk_path,height,lean,trunk_index in trunk_paths:
        for level,z in enumerate(heights):
            if z>height-.25: continue
            anchor=_path_point(trunk_path,z/height)
            count=5 if level<4 else 4
            for bi in range(count):
                angle=TAU*bi/count+level*1.1+trunk_index*.6+rng.uniform(-.16,.16)
                outward=Vector((math.cos(angle),math.sin(angle),0.0))
                length=rng.uniform(1.0,2.0)*(1.0-.08*level)
                path=_branch(anchor+outward*.12,outward,length,rise=rng.uniform(.28,.58),
                             sway=rng.uniform(-.18,.18),samples=5 if lod_level<3 else 3)
                keep=(bi+level+trunk_index)%branch_period==0
                if keep:
                    radius=.045*(1-.08*level)
                    _wood(shape,path,[radius,radius*.70,radius*.40,.004],lod_level,slot=0,sides=5,smooth=True)
                    branches+=1
                # Fine forklets carry small, individual broad leaves; the
                # atlas card has U across the blade and V root-to-tip.
                for fork in range(3):
                    t=.30+fork*.22; base=_path_point(path,t)
                    tangent=(_v(path[min(len(path)-1,int(t*(len(path)-1))+1)])-
                             _v(path[max(0,int(t*(len(path)-1)))] )).normalized()
                    cross=Vector((-outward.y,outward.x,0))*(-1 if fork==0 else 1)
                    direction=_unit(tangent*.53+cross*.58+Z*rng.uniform(.05,.25))
                    twig_length=rng.uniform(.34,.62)
                    twig=_branch(base,direction,twig_length,rise=.18,sway=.08,samples=4 if lod_level<3 else 2)
                    if lod_level<=2 and keep:
                        rr=.018; _wood(shape,twig,[rr,rr*.53,.002],lod_level,slot=0,sides=4,smooth=True)
                    stations = (.18,.38,.58,.78,.96) if lod_level <= 2 else (.22,.46,.70,.91)
                    for station in stations:
                        leaf_base=_path_point(twig,station)
                        local_axis=(_v(twig[min(len(twig)-1,int(station*(len(twig)-1))+1)])-
                                    _v(twig[max(0,int(station*(len(twig)-1)))] )).normalized()
                        lateral=Vector((-local_axis.y,local_axis.x,0))
                        sign=-1 if (fork+int(station*10))%2 else 1
                        leaf_axis=_unit(local_axis*.36+lateral*sign*.52+Z*rng.uniform(-.08,.21))
                        foliage_scale = 1.65 if lod_level <= 2 else 1.0
                        leaf_length=rng.uniform(.13,.22)*foliage_scale
                        width=rng.uniform(.075,.13)*foliage_scale/math.sqrt(density)
                        leaf_tip=leaf_base+leaf_axis*leaf_length
                        idx=card_state[0]; card_state[0]+=1
                        if _keep_index(idx,density):
                            slot=_leaflet_slot(z,5.5,13.5)
                            sections=2 if lod_level<2 else 1
                            shape.sprig_card(leaf_base,leaf_tip,width,slot,roll=rng.uniform(-.4,.4),
                                             curve=.008,sections=sections)
                            leaf_count+=1
                            # Birch leaves cluster in opposed pairs along the
                            # outer twiglets. Keep the far structural levels
                            # unchanged so their compact silhouette budgets
                            # remain stable.
                            if lod_level <= 2:
                                companion_axis=_unit(local_axis*.34-lateral*sign*.58+Z*.08)
                                companion_tip=leaf_base+companion_axis*(leaf_length*.86)
                                shape.sprig_card(leaf_base,companion_tip,width*.88,slot,
                                                 roll=-.24*sign,curve=.008,sections=sections)
                                cross_axis=_unit(local_axis*.59+lateral*sign*.22+Z*.05)
                                cross_tip=leaf_base+cross_axis*(leaf_length*.76)
                                shape.sprig_card(leaf_base,cross_tip,width*.80,slot,
                                                 roll=.32*sign,curve=.008,sections=sections)
                                leaf_count+=2
    return shape,{"height_m":14.0,"forked_trunks":len(trunk_paths),"woody_branches":branches,
                  "leaf_cards":leaf_count,"leaf_candidates":card_state[0],"foliage_density":density,"lod_level":lod_level}


def build_fan_palm(seed=4229, foliage_density=None, lod_level=0):
    """Curved ringed palm trunk and fan-like solid fronds with split leaflets."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    if foliage_density is None: foliage_density=(1.0,.78,.56,.34,.16)[lod_level]
    density=max(.02,min(1.0,float(foliage_density)))
    trunk_controls=[(0,0,.02),(.10,-.03,2.0),(.22,-.06,4.2),(.13,.02,6.4),(.03,.08,8.65)]
    trunk_path=_catmull_rom(trunk_controls,12 if lod_level<3 else 5)
    trunk_radii=[]
    for point in trunk_path:
        t=point[2]/8.65
        ring=.020*math.cos(TAU*point[2]/.24)
        trunk_radii.append(max(.075,(.39*(1-.43*t)+ring)*(1-.02*t)))
    _wood(shape,trunk_path,trunk_radii,lod_level,slot=0,sides=14,smooth=True)
    crown=_v(trunk_path[-1])+Vector((0,0,.02))
    frond_count=(10,9,8,6,4)[lod_level]
    leaf_count=0; petioles=0
    fan_count=(15,13,10,8,6)[lod_level]
    blade_segments=(6,5,4,2,1)[lod_level]
    for fi in range(frond_count):
        angle=TAU*fi/frond_count+rng.uniform(-.10,.10)
        outward=Vector((math.cos(angle),math.sin(angle),0.0))
        tangent=Vector((-outward.y,outward.x,0.0))
        length=rng.uniform(3.1,4.25)
        path=_branch(crown,outward,length,rise=rng.uniform(-.23,-.07),sway=rng.uniform(-.20,.20),
                     samples=8 if lod_level<3 else 4,side=tangent)
        radii=[max(.006,.054*(1-i/(len(path)-1))**1.3) for i in range(len(path))]
        if lod_level<4 or fi%2==0:
            _wood(shape,path,radii,lod_level,slot=0,sides=6,smooth=True); petioles+=1
        fan_indices=range(fan_count) if _keep_index(fi,density) else ()
        for blade_i in fan_indices:
            t=.26+.70*blade_i/max(1,fan_count-1)
            attach=_path_point(path,.48)
            fan_angle=(blade_i/(fan_count-1)-.5)*1.82
            blade_direction=_unit(outward*math.cos(fan_angle)+tangent*math.sin(fan_angle)+Z*rng.uniform(-.16,.12))
            blade_length=length*(.54+.28*math.cos(fan_angle))
            base=attach + blade_direction*(.15+abs(fan_angle)*.10)
            tip=base+blade_direction*blade_length+Z*rng.uniform(-.36,.06)
            width=rng.uniform(.14,.21)/math.sqrt(density)
            section_slot=1+(blade_i%4)
            _curved_blade(shape,base,tip,width,.024,slot=section_slot,segments=blade_segments,
                          bend=tangent*math.sin(fan_angle)*.18)
            leaf_count+=1
    return shape,{"height_m":9.0,"fronds":petioles,"solid_leaflets":leaf_count,
                  "foliage_density":density,"lod_level":lod_level}


# ---------------------------------------------------------------------------
# Alien flora and static fauna

def build_spiral_succulent(seed=4301, lod_level=0):
    """Twisting central stem carries overlapping fleshy leaves in a spiral."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    stem_controls=[(0,0,.025),(.035,-.01,.25),(.085,.025,.62),(.025,.075,1.02),(-.045,.09,1.35)]
    stem_path=_catmull_rom(stem_controls,8 if lod_level<3 else 3)
    _wood(shape,stem_path,[.16*(1-i/(len(stem_path)-1)*.82) for i in range(len(stem_path))],lod_level,slot=0,sides=10,smooth=True)
    leaves_per_ring=(14,12,10,7,5)[lod_level]
    rings=((.12,.62),(.32,.72),(.53,.63),(.74,.49),(.94,.33),(1.12,.22),(1.29,.13))
    leaf_segments=(9,7,5,3,2)[lod_level]; leaves=0
    for ring_index,(z,length) in enumerate(rings):
        count=max(3,leaves_per_ring - (ring_index//3))
        center=_path_point(stem_path,z/1.35)
        for i in range(count):
            angle=TAU*i/count + ring_index*1.72 + rng.uniform(-.12,.12)
            radial=Vector((math.cos(angle),math.sin(angle),0.0))
            tangent=Vector((-radial.y,radial.x,0.0))
            start=center+radial*.09
            outward=radial*rng.uniform(.78,1.0)+tangent*rng.uniform(-.14,.14)
            lift=(.40+.16*ring_index/len(rings)) if ring_index>2 else rng.uniform(-.10,.10)
            direction=_unit(outward+Z*lift)
            leaf_length=length*rng.uniform(.84,1.12)
            tip=start+direction*leaf_length
            width=(.17+.018*ring_index)*rng.uniform(.88,1.12)
            slot=min(5,1+ring_index//2)
            if lod_level==4 and (i+ring_index)%3: continue
            _curved_blade(shape,start,tip,width,.070 if ring_index<3 else .052,slot=slot,
                          segments=leaf_segments,bend=tangent*rng.uniform(-.09,.09)+Z*rng.uniform(-.03,.07),
                          width_profile=((0,.22),(.20,.85),(.50,1),(.78,.70),(1,.025)))
            leaves+=1
    return shape,{"height_m":1.4,"spiral_rosette_layers":len(rings),"fleshy_leaves":leaves,"lod_level":lod_level}


def _add_trumpet(shape, center, height, radius, seed, sides=28, segments=10):
    """Closed hollow fluted trumpet: outside, curled lip, inside and foot."""
    rng=random.Random(seed); center=_v(center)
    profile=((0.00,.22),(.08,.28),(.24,.31),(.43,.38),(.62,.53),(.78,.76),(.90,1.0),(.97,1.04),(1.0,.94))
    outer=[]; inner=[]; uv_outer=[]; uv_inner=[]
    for ri,(t,scale) in enumerate(profile):
        outer_ring=[]; inner_ring=[]
        for si in range(sides):
            angle=TAU*si/sides
            flute=1.0+.095*math.cos(7*angle+t*3.6+seed*.01)+.027*math.sin(13*angle-t*2.1)
            curl=.020*height*math.sin(5*angle+seed*.07) if ri>=len(profile)-2 else 0.0
            rr=radius*scale*flute
            z=center.z+height*t+curl
            outer_ring.append((center.x+rr*math.cos(angle),center.y+rr*math.sin(angle),z))
            thickness=.025*height*(.70+.30*t)
            inner_rr=max(.012,rr-thickness)
            inner_ring.append((center.x+inner_rr*math.cos(angle),center.y+inner_rr*math.sin(angle),z-.009*height))
        outer.append(outer_ring); inner.append(inner_ring)
    for ring_index, ring in enumerate(outer):
        uv_outer.append([(si/sides,ring_index/(len(profile)-1)) for si in range(sides)])
    for ring_index, ring in enumerate(inner):
        uv_inner.append([(si/sides,.045+.91*ring_index/(len(profile)-1)) for si in range(sides)])
    vertices=[p for ring in outer for p in ring]+[p for ring in inner for p in ring]
    n=len(profile); inner_offset=n*sides; faces=[]; uv_faces=[]; slots=[]
    for ri in range(n-1):
        t=(profile[ri][0]+profile[ri+1][0])*.5
        slot=2 if t<.52 else 3 if t<.82 else 4
        if t>.90: slot=5 if seed%2 else 7
        for si in range(sides):
            sj=(si+1)%sides; a=ri*sides+si; b=ri*sides+sj; c=(ri+1)*sides+sj; d=(ri+1)*sides+si
            faces.append((a,b,c,d)); uv_faces.append((uv_outer[ri][si],uv_outer[ri][sj],uv_outer[ri+1][sj],uv_outer[ri+1][si])); slots.append(slot)
            ia,ib,ic,id_=(inner_offset+ri*sides+si,inner_offset+ri*sides+sj,inner_offset+(ri+1)*sides+sj,inner_offset+(ri+1)*sides+si)
            faces.append((ia,id_,ic,ib)); uv_faces.append((uv_inner[ri][si],uv_inner[ri+1][si],uv_inner[ri+1][sj],uv_inner[ri][sj])); slots.append(6 if ri>5 else 1)
    # Outer and inner rims join across a narrow UV strip, so all triangles keep
    # a nonzero atlas area after native quantization.
    for si in range(sides):
        sj=(si+1)%sides
        a=(n-1)*sides+si; b=(n-1)*sides+sj; c=inner_offset+(n-1)*sides+sj; d=inner_offset+(n-1)*sides+si
        faces.append((a,b,c,d)); uv_faces.append(((si/sides,.95),(sj/sides,.95),(sj/sides,1.0),(si/sides,1.0))); slots.append(5)
        a=si; b=sj; c=inner_offset+sj; d=inner_offset+si
        faces.append((a,d,c,b)); uv_faces.append(((si/sides,0.0),(si/sides,.05),(sj/sides,.05),(sj/sides,0.0))); slots.append(2)
    shape.add_component(vertices,faces,slots,smooth=False,uv_faces=uv_faces)


def build_trumpet_fungus(seed=4313, lod_level=0):
    """Cluster of fluted hollow fungal horns with curled, open mouths."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    centers=[(-.18,-.10,.0),(.02,.09,.0),(.18,-.06,.0),(-.04,-.25,.0),(.28,.16,.0),(-.28,.19,.0),(.02,.31,.0),(-.36,-.12,.0),(.37,.02,.0)]
    heights=(.63,.52,.44,.39,.34,.31,.29,.26,.23)
    count=(9,8,7,5,3)[lod_level]; sides=(32,24,20,14,8)[lod_level]; segments=(10,8,7,5,3)[lod_level]
    for index,(center,height) in enumerate(zip(centers[:count],heights[:count])):
        scale=rng.uniform(.88,1.12)
        stem_radius=rng.uniform(.055,.082)*scale
        _add_trumpet(shape,center,height*scale,stem_radius,seed+index*17,sides=sides,segments=segments)
    return shape,{"trumpet_count":count,"fluted_hollow_mouths":count,"lod_level":lod_level}


def _sail_panel(shape, base, tip, across, width, thickness, slot, along=22, across_steps=16,
                bend=(0,0,0), lod_level=0):
    """Solid, gridded sail membrane with a closed rim and meaningful UVs."""
    base,tip,across=_v(base),_v(tip),_unit(across,(1,0,0)); axis=(tip-base).normalized()
    depth=axis.cross(across).normalized(); bend=_v(bend)
    along=max(2,int(along)); across_steps=max(2,int(across_steps))
    per=across_steps+1; grid_size=(along+1)*per
    vertices=[]; top_uv=[]
    for side in range(2):
        for i in range(along+1):
            t=i/along; center=base.lerp(tip,t)+bend*math.sin(math.pi*t)
            fullness=math.sin(math.pi*t)**.62
            for j in range(across_steps+1):
                u=j/across_steps
                half=width*fullness*(.96+.08*math.sin(4*math.pi*u+t*2))*.5
                camber=math.sin(math.pi*u)*math.sin(math.pi*t)*.11
                point=center+across*((u-.5)*width*fullness)+depth*(camber+(thickness*.5 if side==0 else -thickness*.5))
                vertices.append(tuple(point)); top_uv.append((u,t))
    faces=[]; uv_faces=[]; slots=[]
    def idx(side,i,j): return side*grid_size+i*per+j
    for i in range(along):
        for j in range(across_steps):
            a,b,c,d=idx(0,i,j),idx(0,i+1,j),idx(0,i+1,j+1),idx(0,i,j+1)
            faces.append((a,b,c,d)); uv_faces.append((top_uv[a],top_uv[b],top_uv[c],top_uv[d]))
            slots.append(slot)
            a,b,c,d=idx(1,i,j),idx(1,i,j+1),idx(1,i+1,j+1),idx(1,i+1,j)
            faces.append((a,b,c,d)); uv_faces.append((top_uv[a],top_uv[b],top_uv[c],top_uv[d])); slots.append(slot)
    # Perimeter quads close the thin surface. The small UV width is intentional.
    boundary=[]
    boundary += [(0,j) for j in range(across_steps+1)]
    boundary += [(i,across_steps) for i in range(1,along+1)]
    boundary += [(along,j) for j in reversed(range(across_steps))]
    boundary += [(i,0) for i in reversed(range(1,along))]
    for edge in range(len(boundary)):
        i,j=boundary[edge]; ni,nj=boundary[(edge+1)%len(boundary)]
        a,b,c,d=idx(0,i,j),idx(0,ni,nj),idx(1,ni,nj),idx(1,i,j)
        u0,v0=top_uv[a]; u1,v1=top_uv[b]
        if abs(u1-u0) >= abs(v1-v0):
            inset_v = .035 if (v0+v1)*.5 < .5 else -.035
            side_uv=((u0,v0),(u1,v1),(u1,v1+inset_v),(u0,v0+inset_v))
        else:
            inset_u = .035 if (u0+u1)*.5 < .5 else -.035
            side_uv=((u0,v0),(u1,v1),(u1+inset_u,v1),(u0+inset_u,v0))
        uv_faces.append(side_uv)
        faces.append((a,b,c,d)); slots.append(slot)
    shape.add_component(vertices,faces,slots,smooth=False,uv_faces=uv_faces)


def build_sail_pod(seed=4321, lod_level=0):
    """Tall branching stems support broad, veined opaque sail membranes."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    stem_controls=[(0,0,.02),(.07,-.02,1.3),(-.03,.03,2.7),(.10,.05,4.15),(.22,-.02,5.5),(.28,.04,6.75)]
    main_path=_catmull_rom(stem_controls,10 if lod_level<3 else 4)
    _wood(shape,main_path,[.18*(1-i/(len(main_path)-1)*.84) for i in range(len(main_path))],lod_level,slot=0,sides=9,smooth=True)
    sail_count=(7,6,5,4,3)[lod_level]; panels=[]; veins=0
    for i in range(sail_count):
        t=.20+i*.105+rng.uniform(-.025,.025)
        if t>.9: t=.9
        attach=_path_point(main_path,t); tangent=Vector((-attach.y,attach.x,0));
        if tangent.length<1e-6: tangent=Vector((1,0,0))
        tangent.normalize()
        angle=TAU*i/sail_count+rng.uniform(-.2,.2)
        outward=Vector((math.cos(angle),math.sin(angle),0))
        direction=_unit(outward*.60+Z*rng.uniform(.48,.78))
        length=rng.uniform(1.75,2.55)*(1.0-.12*i/max(1,sail_count-1))
        width=rng.uniform(1.4,2.0)*(1.0-.1*i/max(1,sail_count-1))
        tip=attach+direction*length+outward*rng.uniform(-.25,.25)
        side=Vector((-direction.y,direction.x,0));
        if side.dot(tangent)<0: side.negate()
        bend=outward*rng.uniform(.12,.38)+tangent*rng.uniform(-.18,.18)
        if lod_level>=3: along,across_steps=(5,4) if lod_level==3 else (2,2)
        else: along,across_steps=(22,16) if lod_level==0 else (14,10)
        slot=2+(i%3)
        _sail_panel(shape,attach,tip,side,width,.045,slot,along,across_steps,bend,lod_level)
        panels.append((attach,tip,side,width,bend,slot))
        # A central vein plus fine branching ribs sit on the membrane surface.
        rib_count=(9,6,4,2,0)[lod_level]
        for rib in range(rib_count):
            u=(rib+1)/(rib_count+1)
            base=attach.lerp(tip,.11)+side*((u-.5)*width*.12)
            end=attach.lerp(tip,.78)+side*((u-.5)*width*.82)+bend*.65
            vein_path=[tuple(base),tuple(base.lerp(end,.48)+Vector((0,0,.025))),tuple(end+Vector((0,0,.012)))]
            _wood(shape,vein_path,[.012,.007,.0025],lod_level,slot=1,sides=4,smooth=False); veins+=1
    return shape,{"height_m":7.0,"sail_panels":len(panels),"vein_ribs":veins,"lod_level":lod_level}


def build_glass_urchin(seed=4337, lod_level=0):
    """Static radial-bodied fauna with individually closed mineral spines."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    body_sub=(3,2,2,1,1)[lod_level]
    body_tris=_rock_component(shape,(0,0,.22),(.22,.22,.20),body_sub,seed+7,style="ice",smooth=True,
                              roughness=.04,base_z=.018)
    spine_count=(132,94,56,28,12)[lod_level]
    for i in range(spine_count):
        z=rng.uniform(.02,.98); angle=TAU*i/spine_count+rng.uniform(-.18,.18)
        radial=math.sqrt(max(.02,1-z*z)); direction=Vector((radial*math.cos(angle),radial*math.sin(angle),z))
        base=Vector((direction.x*.18,direction.y*.18,.22+direction.z*.16))
        length=rng.uniform(.18,.34)
        tip=base+direction*length
        shape.tetra_needle(base,tip,rng.uniform(.011,.021),slot=5 if i%5 else 6)
    # Two protected eye-ridges are low smooth ovals, not decorative spheres.
    for side in (-1,1):
        eye_base=Vector((side*.065,-.185,.27)); eye_tip=eye_base+Vector((0,-.045,.0))
        shape.tetra_needle(eye_base,eye_tip,.018,slot=7)
    return shape,{"height_m":.7,"body_triangles":body_tris,"closed_spines":spine_count,"lod_level":lod_level}


def _domed_shell(shape, center=(0,0,.62), height=1.0, seed=4349, sides=56, rings=12, lod_level=0):
    rng=random.Random(seed); cx,cy,cz=center
    vertices=[]; rows=[]
    for ri in range(rings+1):
        t=ri/rings
        radius=math.sqrt(max(.002,1-t*t))
        row=[]
        for si in range(sides):
            angle=TAU*si/sides
            ripple=1+.018*math.sin(5*angle+seed*.2)+.012*math.cos(11*angle-t*4)
            x=cx+.92*radius*ripple*math.cos(angle)
            y=cy+.57*radius*ripple*math.sin(angle)
            z=cz+height*t+.012*math.sin(angle*8+t*3)
            row.append(len(vertices)); vertices.append((x,y,z))
        rows.append(row)
    faces=[]; slots=[]
    # Pale overlapping plate colors form broad growth sectors across the dome.
    sectors=8
    for ri in range(rings):
        for si in range(sides):
            nxt=(si+1)%sides
            faces.append((rows[ri][si],rows[ri][nxt],rows[ri+1][nxt],rows[ri+1][si]))
            sector=(si*sectors)//sides
            slots.append(2+(sector%3))
    bottom=len(vertices); vertices.append((cx,cy,cz-.04))
    for si in range(sides): faces.append((bottom,rows[0][(si+1)%sides],rows[0][si])); slots.append(2)
    top=len(vertices); vertices.append((cx,cy,cz+height*1.002))
    for si in range(sides): faces.append((top,rows[-1][si],rows[-1][(si+1)%sides])); slots.append(4)
    shape.add_component(vertices,faces,slots,smooth=False)
    # Raised, thin growth rings follow each actual shell contour.
    ring_count=(7,5,3,2,0)[lod_level]
    for idx in range(ring_count):
        t=.16+idx*.105; radius=math.sqrt(max(.05,1-t*t))
        path=[]
        for si in range(sides+1):
            angle=TAU*si/sides
            path.append((cx+.925*radius*math.cos(angle),cy+.575*radius*math.sin(angle),cz+t+.02))
        _wood(shape,path,[.014 if lod_level<3 else .009]*len(path),lod_level,slot=5+idx%3,sides=4,smooth=True)


def build_shell_grazer(seed=4357, lod_level=0):
    """Low static alien beneath a grooved, overlapping shell carapace."""
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    _rock_component(shape,(0,-.08,.31),(.86,.50,.28),(3,2,2,1,1)[lod_level],seed+1,
                    style="stone",smooth=True,roughness=.05,base_z=.018)
    # Head extends forward and stays under the shell's leading edge.
    _rock_component(shape,(0,-.72,.37),(.32,.34,.26),(2,2,1,1,1)[lod_level],seed+3,
                    style="stone",smooth=True,roughness=.025,base_z=.02)
    # Six articulated, softly curved walking legs support the body.
    leg_count=(6,6,4,4,2)[lod_level]
    for i in range(leg_count):
        side=-1 if i%2==0 else 1; row=i//2
        start=Vector((side*.52,-.42+row*.31,.28))
        end=Vector((side*(.86+row*.025),-.49+row*.32,.045))
        path=[tuple(start),tuple(start.lerp(end,.48)+Vector((side*.05,0,-.025))),tuple(end)]
        _wood(shape,path,[.12,.085,.033],lod_level,slot=0,sides=6,smooth=True)
    _domed_shell(shape,center=(0,.015,.59),height=1.35,seed=seed+8,sides=(64,48,32,20,12)[lod_level],
                 rings=(13,10,8,5,3)[lod_level],lod_level=lod_level)
    if lod_level<=2:
        for side in (-1,1):
            base=Vector((side*.15,-.94,.46)); mid=base+Vector((side*.12,-.23,.26)); tip=mid+Vector((side*.06,-.18,.12))
            _wood(shape,[tuple(base),tuple(mid),tuple(tip)],[.024,.015,.003],lod_level,slot=6,sides=4,smooth=True)
    return shape,{"height_m":2.0,"shell_growth_rings":(7,5,3,2,0)[lod_level],
                  "support_legs":leg_count,"lod_level":lod_level}


# ---------------------------------------------------------------------------
# Original solid groundcover; no tree cutout cards or alpha masks are used.

def _build_grass_blades(seed, lod_level, count_by_lod, height_range, width_range,
                        segments_by_lod, palette_slots, curl=0.0, basal_radius=.0):
    shape=Shape(); rng=random.Random(seed); lod_level=max(0,min(4,int(lod_level)))
    count=count_by_lod[lod_level]; segments=segments_by_lod[lod_level]; made=0
    for i in range(count):
        angle=TAU*i/count+rng.uniform(-.24,.24)
        radial=Vector((math.cos(angle),math.sin(angle),0.0))
        base=radial*rng.uniform(0,basal_radius) + Vector((0,0,.006))
        height=rng.uniform(*height_range)
        tip=base+Z*height+radial*rng.uniform(.03,.17)
        side=Vector((-radial.y,radial.x,0.0))
        bend=radial*rng.uniform(-curl,curl)+side*rng.uniform(-curl*.6,curl*.6)
        width=rng.uniform(*width_range)
        slot=palette_slots[i%len(palette_slots)]
        _curved_blade(shape,base,tip,width,max(.004,width*.16),slot,segments,
                      bend=bend,width_profile=((0,.15),(.24,.88),(.62,.78),(1,.025)))
        made+=1
    return shape,made


def build_meadow_grass(seed=4403, lod_level=0):
    lod_level=max(0,min(4,int(lod_level)))
    shape,count=_build_grass_blades(seed,lod_level,(22,16,12,8,5),(.23,.32),(.018,.030),
                                    (5,4,3,2,1),(1,2,3,4),curl=.07,basal_radius=.05)
    return shape,{"height_m":.3,"solid_blades":count,"lod_level":lod_level}


def build_dry_bunchgrass(seed=4409, lod_level=0):
    lod_level=max(0,min(4,int(lod_level)))
    shape,count=_build_grass_blades(seed,lod_level,(24,18,13,8,5),(.48,.70),(.014,.024),
                                    (6,4,3,2,1),(2,3,4,5),curl=.14,basal_radius=.055)
    rng=random.Random(seed+91); heads=(16,12,8,4,1)[lod_level]
    for i in range(heads):
        angle=TAU*i/heads+rng.uniform(-.2,.2); direction=Vector((math.cos(angle),math.sin(angle),0))
        base=direction*rng.uniform(.02,.15)+Vector((0,0,rng.uniform(.39,.55)))
        path=[tuple(base),tuple(base+direction*.045+Vector((0,0,.055))),tuple(base+direction*.13+Vector((0,0,.09)))]
        if lod_level<4: _wood(shape,path,[.008,.006,.002],lod_level,slot=0,sides=4,smooth=False)
        grains=(4,3,2,1,0)[lod_level]
        for grain in range(grains):
            t=.42+grain*.17; anchor=_path_point(path,t)
            seed_direction=_unit(direction* rng.uniform(.35,.8)+Z*rng.uniform(.15,.55))
            tip=anchor+seed_direction*rng.uniform(.035,.065)
            _curved_blade(shape,anchor,tip,.018,.008,slot=6 if grain%2 else 7,
                          segments=2 if lod_level<3 else 1,
                          width_profile=((0,.3),(.45,1.0),(1,.02)))
    return shape,{"height_m":.7,"solid_blades":count,"seed_panicles":heads,"lod_level":lod_level}


def build_alien_ribbon_grass(seed=4417, lod_level=0):
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    counts=(17,13,10,7,4); segments=(8,6,4,2,1); blades=0
    for i in range(counts[lod_level]):
        angle=TAU*i/counts[lod_level]+rng.uniform(-.28,.28)
        radial=Vector((math.cos(angle),math.sin(angle),0)); side=Vector((-radial.y,radial.x,0))
        base=radial*rng.uniform(.0,.09)+Vector((0,0,.008))
        length=rng.uniform(.31,.45)
        direction=_unit(Z*rng.uniform(.82,1.0)+radial*rng.uniform(.08,.22))
        tip=base+direction*length
        bend=radial*rng.uniform(.08,.20)+side*rng.uniform(-.13,.13)+Z*rng.uniform(.02,.08)
        width=rng.uniform(.032,.055)*(1.45 if lod_level==4 else 1.0)
        _curved_blade(shape,base,tip,width,.012,slot=1+i%5,segments=segments[lod_level],bend=bend,
                      width_profile=((0,.18),(.18,.78),(.48,1.0),(.75,.66),(1,.025)))
        blades+=1
    return shape,{"height_m":.45,"solid_curled_ribbons":blades,"lod_level":lod_level}


def build_alien_spore_mat(seed=4423, lod_level=0):
    lod_level=max(0,min(4,int(lod_level))); shape=Shape(); rng=random.Random(seed)
    sub=(3,2,2,1,1)[lod_level]
    sub = 0 if lod_level == 4 else sub
    body=_rock_component(shape,(0,0,.052),(.46,.38,.050),sub,seed+3,style="ice",smooth=True,
                         roughness=.11,pits=14 if lod_level<2 else 4,base_z=.004)
    filaments=(104,64,34,12,3)[lod_level]; side_filaments=0
    for i in range(filaments):
        angle=TAU*i/max(1,filaments)+rng.uniform(-.16,.16)
        radius=rng.uniform(.18,.42)
        z=rng.uniform(.035,.070)
        start=Vector((math.cos(angle)*radius*.72,math.sin(angle)*radius*.72,z))
        end=Vector((math.cos(angle)*radius,math.sin(angle)*radius,rng.uniform(.085,.115) if lod_level<4 else .105))
        mid=start.lerp(end,.52)+Vector((rng.uniform(-.025,.025),rng.uniform(-.025,.025),.012))
        _wood(shape,[tuple(start),tuple(mid),tuple(end)],[.010,.006,.0018],lod_level,slot=4 if i%4 else 6,sides=4,smooth=True)
        if lod_level<2 and i%4==0:
            fork=end+Vector((rng.uniform(-.06,.06),rng.uniform(-.06,.06),rng.uniform(.01,.03)))
            _wood(shape,[tuple(mid),tuple(end),tuple(fork)],[.005,.003,.001],lod_level,slot=5,sides=3,smooth=True)
            side_filaments+=1
    return shape,{"height_m":.12,"cushion_triangles":body,"filaments":filaments,
                  "side_filaments":side_filaments,"lod_level":lod_level}


# ---------------------------------------------------------------------------
# Manifest-driven stable seven-field definitions.

BUILDERS={
    "river_boulder":build_river_boulder,
    "talus_cluster":build_talus_cluster,
    "desert_arch":build_desert_arch,
    "lava_pebble":build_lava_pebble,
    "giant_redwood":build_giant_redwood,
    "dwarf_juniper":build_dwarf_juniper,
    "silver_birch":build_silver_birch,
    "fan_palm":build_fan_palm,
    "spiral_succulent":build_spiral_succulent,
    "trumpet_fungus":build_trumpet_fungus,
    "sail_pod":build_sail_pod,
    "glass_urchin":build_glass_urchin,
    "shell_grazer":build_shell_grazer,
    "meadow_grass":build_meadow_grass,
    "dry_bunchgrass":build_dry_bunchgrass,
    "alien_ribbon_grass":build_alien_ribbon_grass,
    "alien_spore_mat":build_alien_spore_mat,
}

MANIFEST=json.loads(MANIFEST_PATH.read_text())
DEFINITIONS=tuple((item["id"],item["name"],item["description"],item["category"],
                   BUILDERS[item["id"]],list(item["palette"]),dict(item.get("metadata",{})))
                  for item in MANIFEST)



