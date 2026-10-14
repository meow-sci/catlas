"""Procedural builders for the six remaining Orbit Foundry stock assets.

This module shares the mesh accumulator and tube sweeper from stock_geometry.
Every visible form is modeled from procedural geometry, with authored leaf and
pod UVs where a base-to-tip direction matters.
"""
import math
import random
import importlib.util
import sys
from pathlib import Path

from mathutils import Vector


def _stock_geometry_module():
    for name in ("stock_geometry", "orbit_foundry_stock_geometry"):
        module = sys.modules.get(name)
        if module is not None and hasattr(module, "Shape"):
            return module
    try:
        import stock_geometry
        return stock_geometry
    except ImportError:
        path = Path(__file__).with_name("stock_geometry.py")
        name = "_orbit_foundry_stock_geometry_for_secondary"
        module = sys.modules.get(name)
        if module is None:
            spec = importlib.util.spec_from_file_location(name, path)
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            spec.loader.exec_module(module)
        return module


_stock = _stock_geometry_module()
Shape, TAU = _stock.Shape, _stock.TAU
_path_point, _sample_cubic = _stock._path_point, _stock._sample_cubic


Z_AXIS = Vector((0.0, 0.0, 1.0))


def _vec(value):
    return value.copy() if isinstance(value, Vector) else Vector(value)


def _unit(value, fallback=Z_AXIS):
    value = _vec(value)
    return value.normalized() if value.length > 1e-8 else _vec(fallback).normalized()


def _frame(axis, preferred=Z_AXIS):
    axis = _unit(axis)
    preferred = _unit(preferred)
    if abs(axis.dot(preferred)) > 0.92:
        preferred = Vector((0.0, 1.0, 0.0))
    u = axis.cross(preferred).normalized()
    v = axis.cross(u).normalized()
    return axis, u, v


def _leaf(
    shape,
    base,
    tip,
    width,
    slot,
    rng,
    front=Z_AXIS,
    bend=None,
    thickness=None,
    ridge=0.16,
):
    """A closed, curved lenticular blade with base-to-tip UVs and a raised midrib."""
    base, tip = _vec(base), _vec(tip)
    axis = _unit(tip - base)
    front = _vec(front) - axis * _vec(front).dot(axis)
    if front.length < 1e-7:
        front = Vector((0.0, 0.0, 1.0)) - axis * axis.z
    if front.length < 1e-7:
        front = Vector((0.0, 1.0, 0.0)) - axis * axis.y
    front.normalize()
    side = front.cross(axis).normalized()
    front = axis.cross(side).normalized()
    if bend is None:
        bend = side * rng.uniform(-0.10, 0.10) * width + front * rng.uniform(-0.05, 0.09) * width
    else:
        bend = _vec(bend)
    thickness = max(float(thickness or width * 0.105), 0.003)
    stations = (0.045, 0.505, 0.965)
    across = (-1.0, 0.0, 1.0)
    vertices = []
    for layer in (1.0, -1.0):
        for t in stations:
            center = base.lerp(tip, t) + bend * math.sin(math.pi * t)
            envelope = (0.055 + 0.945 * math.sin(math.pi * t) ** 0.72) * width * 0.5
            arch = width * 0.105 * math.sin(math.pi * t)
            for lateral in across:
                ridge_height = width * ridge * math.sin(math.pi * t) * (1.0 - abs(lateral))
                if layer > 0:
                    height = thickness * 0.5 + arch * (1.0 - lateral * lateral) + ridge_height
                else:
                    height = -(thickness * 0.5 + arch * 0.08 * (1.0 - lateral * lateral))
                point = center + side * (envelope * lateral) + front * height
                vertices.append(tuple(point))

    def top_id(station, across_index):
        return station * 3 + across_index

    def back_id(station, across_index):
        return 9 + station * 3 + across_index

    def surf_uv(station, across_index, layer=0):
        u = 0.025 + 0.95 * (across_index * 0.5)
        v = 0.025 + 0.95 * stations[station]
        return (u, v + layer * 0.006)

    faces, uv_faces = [], []
    for station in range(2):
        for across_index in range(2):
            a = top_id(station, across_index)
            b = top_id(station, across_index + 1)
            c = top_id(station + 1, across_index + 1)
            d = top_id(station + 1, across_index)
            faces.append((d, c, b, a))
            uv_faces.append((surf_uv(station + 1, across_index), surf_uv(station + 1, across_index + 1),
                             surf_uv(station, across_index + 1), surf_uv(station, across_index)))
            a = back_id(station, across_index)
            b = back_id(station + 1, across_index)
            c = back_id(station + 1, across_index + 1)
            d = back_id(station, across_index + 1)
            faces.append((d, c, b, a))
            uv_faces.append((surf_uv(station, across_index + 1), surf_uv(station + 1, across_index + 1),
                             surf_uv(station + 1, across_index), surf_uv(station, across_index)))

    # The two thin longitudinal edges receive a narrow UV strip. Its small U
    # span keeps derivatives finite while V continues from the leaf base to tip.
    for edge, across_index in enumerate((0, 2)):
        for station in range(2):
            a = top_id(station, across_index)
            b = top_id(station + 1, across_index)
            c = back_id(station + 1, across_index)
            d = back_id(station, across_index)
            u0 = 0.018 if edge == 0 else 0.956
            u1 = u0 + 0.024
            v0 = 0.025 + 0.95 * stations[station]
            v1 = 0.025 + 0.95 * stations[station + 1]
            if edge == 0:
                faces.append((d, c, b, a))
                uv_faces.append(((u1, v0), (u1, v1), (u0, v1), (u0, v0)))
            else:
                faces.append((a, b, c, d))
                uv_faces.append(((u0, v0), (u0, v1), (u1, v1), (u1, v0)))

    # Fan each narrow cap around its own interior point. This keeps every
    # exported triangle's UV area nonzero, including the first cap triangle.
    for station in (0, 2):
        v_top = 0.018 if station == 0 else 0.968
        v_back = v_top + (0.016 if station == 0 else -0.016)
        cap_center = len(vertices)
        vertices.append(tuple((Vector(vertices[top_id(station, 1)]) + Vector(vertices[back_id(station, 1)])) * 0.5))
        boundary = (top_id(station, 0), top_id(station, 1), top_id(station, 2),
                    back_id(station, 2), back_id(station, 1), back_id(station, 0))
        boundary_uvs = ((0.025, v_top), (0.50, v_top), (0.975, v_top),
                        (0.975, v_back), (0.50, v_back), (0.025, v_back))
        center_uv = (0.50, (v_top + v_back) * 0.5)
        for edge in range(len(boundary)):
            if station == 2:
                faces.append((boundary[(edge + 1) % len(boundary)], boundary[edge], cap_center))
                uv_faces.append((boundary_uvs[(edge + 1) % len(boundary)], boundary_uvs[edge], center_uv))
            else:
                faces.append((boundary[edge], boundary[(edge + 1) % len(boundary)], cap_center))
                uv_faces.append((boundary_uvs[edge], boundary_uvs[(edge + 1) % len(boundary)], center_uv))

    shape.add_component(vertices, faces, slot, smooth=True, uv_faces=uv_faces)


def _sprig_card(shape, base, tip, width, slot, front, bend=None):
    """Curved open cutout card with full-width U and root-to-tip V coordinates."""
    base, tip = _vec(base), _vec(tip)
    axis = _unit(tip - base)
    front = _vec(front) - axis * _vec(front).dot(axis)
    if front.length < 1e-7:
        front = Vector((0.0, 0.0, 1.0)) - axis * axis.z
    if front.length < 1e-7:
        front = Vector((0.0, 1.0, 0.0))
    front.normalize()
    side = front.cross(axis).normalized()
    front = axis.cross(side).normalized()
    bend = _vec(bend) if bend is not None else Vector((0.0, 0.0, 0.0))
    stations = (0.04, 0.52, 0.98)
    vertices = []
    for t in stations:
        center = base.lerp(tip, t) + bend * math.sin(math.pi * t)
        # The bitmap alpha supplies the leaflet silhouette. Keep the actual
        # card close to rectangular so the card itself does not taper it again.
        half_width = width * 0.5
        vertices.extend((tuple(center - side * half_width), tuple(center + side * half_width)))
    faces, uv_faces = [], []
    for station in range(2):
        a = station * 2
        b = a + 1
        c = (station + 1) * 2 + 1
        d = (station + 1) * 2
        faces.append((a, d, c, b))
        uv_faces.append(((0.0, stations[station]), (0.0, stations[station + 1]),
                         (1.0, stations[station + 1]), (1.0, stations[station])))
    shape.add_component(vertices, faces, slot, smooth=False, uv_faces=uv_faces)


def _sprig_card_single(shape, base, tip, width, slot, front, bend=None):
    """One gently bowed quad card with root-to-tip UV orientation."""
    base, tip = _vec(base), _vec(tip)
    axis = _unit(tip - base)
    front = _vec(front) - axis * _vec(front).dot(axis)
    if front.length < 1e-7:
        front = Vector((0.0, 0.0, 1.0)) - axis * axis.z
    if front.length < 1e-7:
        front = Vector((0.0, 1.0, 0.0))
    front.normalize()
    side = front.cross(axis).normalized()
    front = axis.cross(side).normalized()
    bend = _vec(bend) if bend is not None else Vector((0.0, 0.0, 0.0))
    t0, t1 = 0.04, 0.98
    c0 = base.lerp(tip, t0) + bend * math.sin(math.pi * t0)
    c1 = base.lerp(tip, t1) + bend * math.sin(math.pi * t1)
    half_width = width * 0.5
    vertices = [tuple(c0 - side * half_width), tuple(c0 + side * half_width),
                tuple(c1 + side * half_width), tuple(c1 - side * half_width)]
    # This winding agrees with axis × across and preserves the root at V=0.
    faces = [(0, 3, 2, 1)]
    uv_faces = [((0.0, t0), (0.0, t1), (1.0, t1), (1.0, t0))]
    shape.add_component(vertices, faces, slot, smooth=False, uv_faces=uv_faces)


def _tube_points(shape, points, radii, slot=0, sides=7, smooth=True):
    shape.tube([tuple(_vec(p)) for p in points], radii, slot=slot, sides=sides, smooth=smooth)


def _thin_profile(path, radii, count):
    """Evenly retain control points and their radii for structural LOD tubes."""
    if count >= len(path):
        return list(path), list(radii)
    indices = [int(round(index * (len(path) - 1) / (count - 1))) for index in range(count)]
    return [path[index] for index in indices], [radii[index] for index in indices]


def _curve_between(start, end, lift=0.0, sway=0.0, samples=5, side=None):
    start, end = _vec(start), _vec(end)
    direction = end - start
    side = _vec(side) if side is not None else Vector((0.0, 1.0, 0.0))
    c1 = start.lerp(end, 0.30) + Z_AXIS * lift * 0.75 + side * sway * 0.4
    c2 = start.lerp(end, 0.70) + Z_AXIS * lift + side * sway
    return _sample_cubic(start, c1, c2, end, samples)


def _radial_profile_component(shape, center, axis, scale, profile, sides, seed,
                               slot_fn, roughness=0.06, uv_along_axis=False):
    """Closed radial shell with a lumpy, multi-ring profile and explicit surface UVs."""
    rng = random.Random(seed)
    center, axis = _vec(center), _unit(axis)
    _axis, u, v = _frame(axis)
    vertices, faces, slots, uv_faces, ring_ids = [], [], [], [], []
    phase = rng.uniform(0.0, TAU)
    for ring_index, (t, radius) in enumerate(profile):
        ring = []
        c = center + axis * (scale[2] * t)
        c += u * (math.sin(t * math.pi * 1.3 + phase) * scale[0] * 0.035)
        c += v * (math.cos(t * math.pi * 1.7 + phase) * scale[1] * 0.025)
        for side_index in range(sides):
            angle = phase + TAU * side_index / sides
            lobe = 1.0 + 0.045 * math.sin(angle * 5.0 + phase) + 0.028 * math.cos(angle * 9.0 - phase)
            jitter = rng.uniform(-roughness, roughness)
            radial = u * math.cos(angle) + v * math.sin(angle)
            p = c + radial * (radius * lobe * (1.0 + jitter) * (scale[0] * math.cos(angle) ** 2 + scale[1] * math.sin(angle) ** 2) ** 0.5)
            p += axis * (rng.uniform(-0.012, 0.012) * scale[2] if ring_index not in (0, len(profile) - 1) else 0.0)
            ring.append(len(vertices))
            vertices.append(tuple(p))
        ring_ids.append(ring)

    for ring_index in range(len(profile) - 1):
        t0, _ = profile[ring_index]
        t1, _ = profile[ring_index + 1]
        for side_index in range(sides):
            nxt = (side_index + 1) % sides
            a, b = ring_ids[ring_index][side_index], ring_ids[ring_index][nxt]
            c, d = ring_ids[ring_index + 1][nxt], ring_ids[ring_index + 1][side_index]
            # A displaced center divides the shell into weathered facets while
            # retaining a watertight surface.
            pa, pb, pc, pd = (Vector(vertices[k]) for k in (a, b, c, d))
            middle = (pa + pb + pc + pd) * 0.25
            normal = (pb - pa).cross(pd - pa)
            if normal.length > 1e-8:
                normal.normalize()
            middle += normal * rng.uniform(-roughness, roughness) * scale[0] * 0.32
            middle_index = len(vertices)
            vertices.append(tuple(middle))
            faces.extend(((a, b, middle_index), (b, c, middle_index),
                          (c, d, middle_index), (d, a, middle_index)))
            slot = slot_fn(ring_index, side_index, t0, t1, angle if False else side_index / sides)
            slots.extend((slot,) * 4)
            if uv_along_axis:
                u0, u1 = side_index / sides, (side_index + 1) / sides
                uv_faces.extend((((u0, t0), (u1, t0), (0.5 * (u0 + u1), 0.5 * (t0 + t1))),
                                 ((u1, t0), (u1, t1), (0.5 * (u0 + u1), 0.5 * (t0 + t1))),
                                 ((u1, t1), (u0, t1), (0.5 * (u0 + u1), 0.5 * (t0 + t1))),
                                 ((u0, t1), (u0, t0), (0.5 * (u0 + u1), 0.5 * (t0 + t1)))))
            else:
                uv_faces.extend([None] * 4)

    bottom_center = len(vertices)
    vertices.append(tuple(center - axis * (0.005 * scale[2])))
    for side_index in range(sides):
        faces.append((bottom_center, ring_ids[0][(side_index + 1) % sides], ring_ids[0][side_index]))
        slots.append(slot_fn(-1, side_index, 0.0, profile[0][0], side_index / sides))
        if uv_along_axis:
            uv_faces.append(((0.5, 0.5), (0.5 + 0.48 * math.cos(TAU * (side_index + 1) / sides),
                                                  0.5 + 0.48 * math.sin(TAU * (side_index + 1) / sides)),
                             (0.5 + 0.48 * math.cos(TAU * side_index / sides),
                              0.5 + 0.48 * math.sin(TAU * side_index / sides))))
        else:
            uv_faces.append(None)
    top_center = len(vertices)
    vertices.append(tuple(center + axis * (scale[2] * 1.005)))
    for side_index in range(sides):
        faces.append((top_center, ring_ids[-1][side_index], ring_ids[-1][(side_index + 1) % sides]))
        slots.append(slot_fn(len(profile) - 1, side_index, profile[-1][0], 1.0, side_index / sides))
        if uv_along_axis:
            uv_faces.append(((0.5, 0.5), (0.5 + 0.48 * math.cos(TAU * side_index / sides),
                                                  0.5 + 0.48 * math.sin(TAU * side_index / sides)),
                             (0.5 + 0.48 * math.cos(TAU * (side_index + 1) / sides),
                              0.5 + 0.48 * math.sin(TAU * (side_index + 1) / sides))))
        else:
            uv_faces.append(None)

    # Keep UV faces either complete or absent; Shape generates stable planar UVs
    # for faceted rocks and uses our explicit circumferential map for pods.
    if uv_along_axis:
        shape.add_component(vertices, faces, slots, smooth=False, uv_faces=uv_faces)
    else:
        shape.add_component(vertices, faces, slots, smooth=False)


def build_layered_sandstone(seed=2107):
    """Wind-eroded, warm sedimentary butte with fractured terraces and strata."""
    shape = Shape()
    rng = random.Random(seed)
    angular = 184
    levels = [
        (0.025, 0.77), (0.075, 0.91), (0.14, 1.08), (0.22, 1.18),
        (0.31, 1.21), (0.405, 1.18), (0.425, 1.27), (0.49, 1.25),
        (0.57, 1.22), (0.665, 1.18), (0.685, 1.27), (0.75, 1.25),
        (0.84, 1.20), (0.94, 1.16), (1.04, 1.10), (1.12, 1.06),
        (1.14, 1.16), (1.22, 1.12), (1.31, 1.06), (1.40, 0.99),
        (1.49, 0.94), (1.51, 1.025), (1.59, 1.00), (1.68, 0.94),
        (1.78, 0.87), (1.89, 0.80), (2.00, 0.73), (2.02, 0.82),
        (2.10, 0.78), (2.20, 0.72), (2.31, 0.65), (2.41, 0.57),
        (2.52, 0.49), (2.62, 0.42), (2.72, 0.34), (2.80, 0.25),
        (2.86, 0.12), (2.88, 0.025),
    ]
    phase = rng.uniform(0, TAU)
    vertices, faces, slots, rings = [], [], [], []
    ring_centers = []
    for level_index, (z, radius) in enumerate(levels):
        center_x = 0.11 * math.sin(z * 1.37 + phase) + 0.035 * math.sin(z * 4.1)
        center_y = 0.10 * math.cos(z * 1.12 + phase) + 0.025 * math.sin(z * 3.3)
        ring = []
        for side_index in range(angular):
            angle = TAU * side_index / angular
            wave = (0.075 * math.sin(3 * angle + phase + z * 0.65)
                    + 0.042 * math.sin(7 * angle - phase * 0.7)
                    + 0.022 * math.cos(13 * angle + z * 1.7))
            notches = 0.0
            for crack_index, crack_angle in enumerate((0.45, 1.73, 2.95, 4.2, 5.55)):
                delta = abs((angle - crack_angle - z * (0.07 + crack_index * 0.006) + math.pi) % TAU - math.pi)
                notches = max(notches, math.exp(-(delta / 0.035) ** 2) * 0.11)
            jitter = rng.uniform(-0.018, 0.018)
            rr = radius * (1.0 + wave + jitter - notches)
            zz = z + 0.009 * math.sin(5 * angle + phase + z * 2.0) + rng.uniform(-0.008, 0.008)
            ring.append(len(vertices))
            vertices.append((center_x + rr * math.cos(angle), center_y + rr * math.sin(angle), zz))
        rings.append(ring)
        ring_centers.append((center_x, center_y))

    crack_angles = (0.45, 1.73, 2.95, 4.2, 5.55)
    for level_index in range(len(rings) - 1):
        lower_z = levels[level_index][0]
        upper_z = levels[level_index + 1][0]
        for side_index in range(angular):
            nxt = (side_index + 1) % angular
            a, b = rings[level_index][side_index], rings[level_index][nxt]
            c, d = rings[level_index + 1][nxt], rings[level_index + 1][side_index]
            angle = TAU * (side_index + 0.5) / angular
            # A quiet, height-driven sediment gradient avoids angular color
            # wedges. Dark material appears only where the shell has a narrow
            # incised fracture; the atlas carries the finer grain variation.
            strata_position = min(0.999, max(0.0, (lower_z + upper_z) * 0.5 / 2.88))
            slot = 1 + min(3, int(strata_position * 4.0))
            crack_distance = min(
                abs((angle - crack_angle - lower_z * (0.07 + crack_index * 0.006) + math.pi) % TAU - math.pi)
                for crack_index, crack_angle in enumerate(crack_angles)
            )
            if crack_distance < 0.034:
                slot = 0
            faces.append((a, b, c, d))
            slots.append(slot)

    bottom_center = len(vertices)
    vertices.append((0.0, 0.0, 0.018))
    for side_index in range(angular):
        faces.append((bottom_center, rings[0][(side_index + 1) % angular], rings[0][side_index]))
        slots.append(1)
    top_center = len(vertices)
    vertices.append((ring_centers[-1][0], ring_centers[-1][1], levels[-1][0] + 0.008))
    for side_index in range(angular):
        faces.append((top_center, rings[-1][side_index], rings[-1][(side_index + 1) % angular]))
        slots.append(7 if side_index == 0 else 6 if side_index % 9 == 0 else 5)
    shape.add_component(vertices, faces, slots, smooth=False)

    # A few naturally broken ledges project from the slope. These are shallow,
    # angular strata plates with warm local variation, not separate dark bands.
    ledge_count = 9
    for index in range(ledge_count):
        angle = rng.uniform(0.0, TAU)
        z = rng.uniform(0.32, 2.18)
        radius = 1.2 * max(0.25, 1.0 - z * 0.22)
        direction = Vector((math.cos(angle), math.sin(angle), 0.06))
        center = Vector((direction.x * radius * 0.90, direction.y * radius * 0.90, z))
        _radial_profile_component(
            shape, center, direction, (rng.uniform(0.12, 0.22), rng.uniform(0.18, 0.31), rng.uniform(0.07, 0.15)),
            [(0.0, 0.56), (0.10, 0.93), (0.28, 1.0), (0.52, 0.82), (0.76, 0.72), (0.94, 0.46), (1.0, 0.16)],
            11, seed + 90 + index,
            lambda ring, side, t0, t1, u: 2 + ((side + index) % 3 == 0),
            roughness=0.12,
        )
    return shape, {"strata_levels": len(levels), "ledge_spurs": ledge_count, "ring_segments": angular}


def _ice_mass(shape, base, direction, length, radii, sides, seed, phase_bias=0.0):
    """Build a broad, fractured ice slab as one closed, triangulated shell."""
    rng = random.Random(seed)
    base, axis = _vec(base), _unit(direction)
    _axis, u, v = _frame(axis)
    profile = [
        (0.0, 0.66), (0.055, 0.84), (0.14, 0.98), (0.25, 1.0),
        (0.37, 0.94), (0.49, 0.88), (0.60, 0.80), (0.70, 0.69),
        (0.79, 0.58), (0.87, 0.46), (0.94, 0.34), (0.985, 0.20), (1.0, 0.07),
    ]
    rings, vertices, faces, slots = [], [], [], []
    phase = rng.uniform(-0.2, 0.2) + phase_bias
    crack_angles = [rng.uniform(0, TAU) for _ in range(4)]
    for ring_index, (t, scale) in enumerate(profile):
        center = base + axis * length * t
        center += u * math.sin(t * 2.5 + phase) * radii[0] * 0.12
        center += v * math.cos(t * 2.0 + phase) * radii[1] * 0.10
        ring = []
        for side_index in range(sides):
            angle = phase + TAU * side_index / sides
            radial = u * math.cos(angle) + v * math.sin(angle)
            shard = 1.0 + 0.11 * math.sin(3.0 * angle + phase) + 0.065 * math.cos(7.0 * angle - t * 4.0)
            fracture = 0.0
            for crack_index, crack_angle in enumerate(crack_angles):
                delta = abs((angle - crack_angle - 0.10 * math.sin(t * 3.0 + crack_index) + math.pi) % TAU - math.pi)
                fracture = max(fracture, math.exp(-(delta / 0.052) ** 2) * (0.14 + 0.05 * math.sin(t * 9.0 + crack_index)))
            jitter = rng.uniform(-0.025, 0.025)
            radial_scale = (scale * shard * (1.0 + jitter) * (1.0 - fracture))
            point = center + radial * (radial_scale * (radii[0] * math.cos(angle) ** 2 + radii[1] * math.sin(angle) ** 2) ** 0.5)
            point += axis * (rng.uniform(-0.045, 0.045) * radii[0] if ring_index not in (0, len(profile) - 1) else 0.0)
            ring.append(len(vertices))
            vertices.append(tuple(point))
        rings.append(ring)

    for ring_index in range(len(profile) - 1):
        t0 = profile[ring_index][0]
        t1 = profile[ring_index + 1][0]
        for side_index in range(sides):
            nxt = (side_index + 1) % sides
            a, b = rings[ring_index][side_index], rings[ring_index][nxt]
            c, d = rings[ring_index + 1][nxt], rings[ring_index + 1][side_index]
            pa, pb, pc, pd = (Vector(vertices[k]) for k in (a, b, c, d))
            center = (pa + pb + pc + pd) * 0.25
            facet_normal = (pb - pa).cross(pd - pa)
            if facet_normal.length > 1e-8:
                facet_normal.normalize()
            center += facet_normal * rng.uniform(-0.055, 0.055) * radii[0]
            center_index = len(vertices)
            vertices.append(tuple(center))
            faces.extend(((a, b, center_index), (b, c, center_index),
                          (c, d, center_index), (d, a, center_index)))
            midpoint = (pa + pb + pc + pd) * 0.25
            height = (midpoint - base).dot(axis) / max(length, 1e-6)
            # Most planes stay within a compact blue range. Frost appears on
            # upper-facing, weather-exposed facets; narrow dark slots mark cracks.
            radial_angle = math.atan2((midpoint - base).dot(v), (midpoint - base).dot(u))
            crack_distance = min(abs((radial_angle - crack - math.pi) % TAU - math.pi) for crack in crack_angles)
            if crack_distance < 0.022:
                tone = 0
            elif crack_distance < 0.040:
                tone = 1
            elif height > 0.68 and facet_normal.dot(Z_AXIS) > 0.48 and rng.random() < 0.20:
                tone = 7 if rng.random() < 0.34 else 5
            else:
                tone = rng.choices((1, 2, 3, 4, 6), weights=(0.19, 0.31, 0.31, 0.17, 0.02))[0]
            slots.extend((tone,) * 4)

    bottom = len(vertices)
    vertices.append(tuple(base - axis * 0.02))
    for side_index in range(sides):
        faces.append((bottom, rings[0][(side_index + 1) % sides], rings[0][side_index]))
        slots.append(1)
    top = len(vertices)
    vertices.append(tuple(base + axis * length))
    for side_index in range(sides):
        faces.append((top, rings[-1][side_index], rings[-1][(side_index + 1) % sides]))
        slots.append(5 if side_index % 3 else 7)
    shape.add_component(vertices, faces, slots, smooth=False)


def build_glacial_shard(seed=2113):
    """A weathered cluster of opaque fractured blue-ice slabs and plates."""
    shape = Shape()
    masses = [
        ((0.00, 0.10, 0.04), (0.07, -0.02, 1.0), 2.63, (0.89, 0.82), 34, 0.1),
        ((-0.58, -0.10, 0.03), (-0.30, 0.03, 0.94), 1.96, (0.74, 0.72), 30, 1.1),
        ((0.66, -0.01, 0.03), (0.31, -0.08, 0.91), 1.89, (0.75, 0.68), 30, 2.2),
        ((-0.38, 0.56, 0.03), (-0.20, 0.10, 0.94), 2.08, (0.68, 0.76), 30, 3.1),
        ((0.42, 0.62, 0.03), (0.22, 0.10, 0.95), 1.72, (0.69, 0.72), 29, 4.0),
        ((-1.05, 0.20, 0.03), (-0.36, 0.05, 0.86), 1.22, (0.50, 0.56), 26, 5.2),
        ((1.02, 0.29, 0.03), (0.39, 0.04, 0.83), 1.17, (0.50, 0.55), 26, 6.1),
        ((-0.64, -0.66, 0.03), (-0.12, -0.06, 0.96), 1.28, (0.58, 0.53), 27, 7.2),
        ((0.70, -0.62, 0.03), (0.17, -0.02, 0.95), 1.25, (0.56, 0.53), 27, 8.0),
    ]
    for index, (base, axis, length, radii, sides, phase) in enumerate(masses):
        _ice_mass(shape, base, axis, length, radii, sides, seed + index * 29, phase)
    return shape, {"fractured_masses": len(masses), "ice_facets": "triangulated shell planes", "fracture_channels": "radial grooves"}


def build_umbrella_tree(seed=2309, foliage_density=None, lod_level=0):
    """Curving savanna tree with exposed forks and a broken, leaf-built crown."""
    shape = Shape()
    rng = random.Random(seed)
    lod_level = max(0, min(4, int(lod_level)))
    if foliage_density is None:
        foliage_density = (1.0, 0.70, 0.36, 0.36, 0.12)[lod_level]
    foliage_density = float(foliage_density)
    if not math.isfinite(foliage_density):
        foliage_density = 1.0
    foliage_density = max(0.0, min(1.0, foliage_density))
    trunk_path = [
        (0.00, 0.00, 0.02), (0.08, -0.01, 0.48), (0.13, 0.01, 1.02),
        (0.08, 0.05, 1.66), (0.01, 0.09, 2.35), (0.06, 0.08, 3.08),
        (0.17, 0.04, 3.78), (0.27, 0.00, 4.34), (0.33, -0.02, 4.76),
    ]
    trunk_radii = [0.31, 0.27, 0.23, 0.19, 0.15, 0.12, 0.085, 0.055, 0.027]
    if lod_level <= 1:
        shape.tube(trunk_path, trunk_radii, slot=0, sides=14, smooth=True)
    else:
        point_count, tube_sides = ((7, 6) if lod_level == 2 else (5, 6) if lod_level == 3 else (4, 5))
        reduced_path, reduced_radii = _thin_profile(trunk_path, trunk_radii, point_count)
        shape.tube(reduced_path, reduced_radii, slot=0, sides=tube_sides, smooth=True)

    # Broad, curved buttress roots flare low and taper into the soil.
    for root_index in range(9):
        angle = TAU * root_index / 9 + rng.uniform(-0.16, 0.16)
        direction = Vector((math.cos(angle), math.sin(angle), 0.0))
        tangent = Vector((-direction.y, direction.x, 0.0))
        length = rng.uniform(0.72, 1.12)
        path = [
            (0.06, 0.02, 0.29),
            tuple(direction * (length * 0.24) + tangent * rng.uniform(-0.06, 0.06) + Vector((0, 0, 0.22))),
            tuple(direction * (length * 0.54) + tangent * rng.uniform(-0.08, 0.08) + Vector((0, 0, 0.11))),
            tuple(direction * length + tangent * rng.uniform(-0.10, 0.10) + Vector((0, 0, 0.02))),
        ]
        root_radii = [rng.uniform(0.17, 0.21), 0.12, 0.065, 0.009]
        if lod_level <= 1:
            shape.tube(path, root_radii, slot=0, sides=9, smooth=True)
        elif lod_level == 2 and root_index % 2 == 0:
            reduced_path, reduced_radii = _thin_profile(path, root_radii, 3)
            shape.tube(reduced_path, reduced_radii, slot=0, sides=5, smooth=True)

    primary_records = []
    whorls = ((2.05, 6), (2.77, 7), (3.46, 7), (4.05, 6))
    for level, (height, count) in enumerate(whorls):
        phase = 0.31 + level * 1.03
        trunk_x = 0.12 + max(0, height - 1.2) * 0.055
        trunk_y = 0.04 + height * 0.003
        for branch_index in range(count):
            angle = phase + TAU * branch_index / count + rng.uniform(-0.12, 0.12)
            outward = Vector((math.cos(angle), math.sin(angle), 0.0))
            cross = Vector((-outward.y, outward.x, 0.0))
            length = rng.uniform(1.35, 2.04) * (1.23 - level * 0.045)
            start = Vector((trunk_x, trunk_y, height)) + outward * rng.uniform(0.07, 0.15)
            lift = rng.uniform(0.20, 0.42)
            droop = rng.uniform(0.08, 0.22)
            vertical_rise = length * max(-0.10, min(0.10, lift - droop - 0.12))
            end = start + outward * length + Z_AXIS * vertical_rise + cross * rng.uniform(-0.18, 0.18)
            path = _curve_between(start, end, lift=length * 0.045, sway=length * rng.uniform(-0.05, 0.05), samples=7, side=cross)
            radius = rng.uniform(0.065, 0.088) * (1.0 - level * 0.10)
            branch_radii = [radius * f for f in (1.0, 0.88, 0.73, 0.58, 0.42, 0.26, 0.08)]
            if lod_level <= 1:
                shape.tube(path, branch_radii, slot=0, sides=8, smooth=True)
            else:
                point_count, tube_sides = ((5, 6) if lod_level == 2 else (4, 5))
                reduced_path, reduced_radii = _thin_profile(path, branch_radii, point_count)
                shape.tube(reduced_path, reduced_radii, slot=0, sides=tube_sides, smooth=True)
            primary_records.append((path, outward, cross, radius, level, angle))

    secondary_records = []
    for primary_path, outward, cross, radius, level, angle in primary_records:
        fork_count = 2 if level in (0, 3) else 3
        for fork in range(fork_count):
            t = (0.34 + fork * (0.29 if fork_count == 3 else 0.40)) + rng.uniform(-0.035, 0.035)
            start = _path_point(primary_path, t)
            sign = -1 if (fork + int(angle * 9)) % 2 else 1
            direction = (outward * 0.72 + cross * sign * rng.uniform(0.25, 0.48) + Z_AXIS * rng.uniform(0.02, 0.15)).normalized()
            length = rng.uniform(0.48, 0.78)
            end = start + direction * length + Z_AXIS * rng.uniform(0.04, 0.12)
            path = _curve_between(start, end, lift=length * rng.uniform(0.02, 0.12), sway=length * 0.06, samples=5, side=cross)
            twig_radius = radius * rng.uniform(0.43, 0.58)
            twig_radii = [twig_radius, twig_radius * 0.77, twig_radius * 0.55, twig_radius * 0.31, 0.0045]
            if lod_level <= 1:
                shape.tube(path, twig_radii, slot=0, sides=6, smooth=True)
            elif lod_level in (2, 3):
                point_count, tube_sides = (5, 6) if lod_level == 2 else (4, 4)
                reduced_path, reduced_radii = _thin_profile(path, twig_radii, point_count)
                shape.tube(reduced_path, reduced_radii, slot=0, sides=tube_sides, smooth=True)
            secondary_records.append((path, direction, outward, cross, twig_radius, level, angle + sign * 0.35))

    terminal_records = []
    for terminal_index, (branch_path, direction, outward, cross, radius, level, angle) in enumerate(secondary_records):
        for fork in range(2):
            t = 0.48 + fork * 0.31 + rng.uniform(-0.03, 0.03)
            start = _path_point(branch_path, t)
            sign = -1 if fork == 0 else 1
            sub_direction = (direction * 0.70 + cross * sign * 0.55 + Z_AXIS * rng.uniform(-0.06, 0.17)).normalized()
            length = rng.uniform(0.27, 0.47)
            end = start + sub_direction * length
            path = _curve_between(start, end, lift=length * 0.10, sway=length * 0.05, samples=4, side=cross)
            twig_radius = max(radius * 0.48, 0.010)
            twig_radii = [twig_radius, twig_radius * 0.68, twig_radius * 0.37, 0.0028]
            if lod_level <= 1:
                shape.tube(path, twig_radii, slot=0, sides=5, smooth=True)
            elif lod_level == 2 and terminal_index % 2 == 0:
                shape.tube(path, twig_radii, slot=0, sides=5, smooth=True)
            terminal_records.append((path, sub_direction, outward, cross, level, angle + sign * 0.45))

    total_sprigs = len(terminal_records) * 9 + len(primary_records) * 3
    retained_sprig_count = total_sprigs if foliage_density >= 1.0 else int(round(total_sprigs * foliage_density))
    if foliage_density > 0.0:
        retained_sprig_count = max(1, retained_sprig_count)
    retained_sprig_count = min(total_sprigs, retained_sprig_count)
    retained_sprig_indices = {
        min(total_sprigs - 1, int(index * total_sprigs / max(1, retained_sprig_count)))
        for index in range(retained_sprig_count)
    } if total_sprigs else set()
    # The leaf-spray atlas has generous negative space, so broad, lightly
    # overlapping cards build a continuous acacia crown while retaining gaps.
    lod_card_compensation = math.sqrt(2.0) if lod_level >= 3 else 1.0
    card_width_scale = (1.25 * lod_card_compensation / math.sqrt(max(foliage_density, 1e-6))
                        if foliage_density > 0.0 else 1.0)
    card_sprigs = 0
    card_count = 0
    solid_leaflets = 0
    solid_descriptors = []
    sprig_index = 0
    foliage_slots = (1, 2, 2, 3, 3, 4)
    # Each fine twig carries crossed, curved compound-sprig cards. Their authored
    # cutout atlas supplies the paired leaflets while the open branch network
    # leaves irregular light gaps through the canopy.
    for path, axis, outward, cross, level, angle in terminal_records:
        local_side = Vector((-axis.y, axis.x, 0.0))
        if local_side.length < 1e-6:
            local_side = cross.copy()
        local_side.normalize()
        vertical = axis.cross(local_side).normalized()
        if vertical.z < 0:
            vertical.negate()
        for station in range(9):
            t = 0.10 + station * 0.098 + rng.uniform(-0.018, 0.018)
            anchor = _path_point(path, t)
            azimuth = TAU * station / 9.0 + angle + rng.uniform(-0.35, 0.35)
            radial = (local_side * math.cos(azimuth) + vertical * math.sin(azimuth)).normalized()
            radial_horizontal = Vector((radial.x, radial.y, 0.0)).normalized()
            leaf_axis = (axis * 0.30 + radial_horizontal * 0.72 + Z_AXIS * rng.uniform(0.04, 0.12)).normalized()
            length = rng.uniform(0.24, 0.34) * (1.0 - level * 0.025)
            tip = anchor + leaf_axis * length
            front = (Z_AXIS * 0.80 + radial_horizontal * 0.20).normalized()
            width = rng.uniform(0.19, 0.27)
            slot = rng.choice(foliage_slots)
            bend = radial * rng.uniform(-0.028, 0.038)
            cross_front = (cross * rng.choice((-1.0, 1.0)) * 0.82 + Z_AXIS * 0.42).normalized()
            cross_width = width * rng.uniform(0.88, 1.05)
            cross_bend = bend * 0.82
            if sprig_index in retained_sprig_indices:
                if lod_level >= 4:
                    _sprig_card_single(shape, anchor, tip, width * card_width_scale, slot,
                                       front=front, bend=bend)
                    card_count += 1
                elif lod_level >= 3:
                    _sprig_card(shape, anchor, tip, width * card_width_scale, slot, front=front, bend=bend)
                    card_count += 1
                else:
                    _sprig_card(shape, anchor, tip, width * card_width_scale, slot, front=front, bend=bend)
                    _sprig_card(shape, anchor, tip, cross_width * card_width_scale, slot,
                                front=cross_front, bend=cross_bend)
                    card_count += 2
                card_sprigs += 1
            sprig_index += 1
            # Modeled solid blades remain as close-up accents over the cutout
            # foliage, using only fully opaque semantic slots 5–7.
            if station % 7 == 2:
                solid_tip = anchor + leaf_axis * (length * rng.uniform(0.58, 0.74))
                solid_width = rng.uniform(0.045, 0.065)
                solid_slot = rng.choice((5, 6, 6, 7))
                solid_descriptors.append((anchor.copy(), solid_tip.copy(), solid_width, solid_slot,
                                          front.copy(), (bend * 0.5).copy()))

    # A few extra fine leaf sprays fill the primary-to-secondary gaps without
    # making a continuous umbrella sheet.
    for path, outward, cross, radius, level, angle in primary_records:
        for station in (0.46, 0.72, 0.91):
            anchor = _path_point(path, station)
            direction = (outward * 0.60 + cross * rng.choice((-1, 1)) * 0.48 + Z_AXIS * 0.035).normalized()
            front = (Z_AXIS * 0.82 + direction * 0.18).normalized()
            length = rng.uniform(0.23, 0.31)
            tip = anchor + direction * length
            width = rng.uniform(0.16, 0.22)
            slot = rng.choice(foliage_slots)
            bend = cross * rng.uniform(-0.025, 0.025)
            cross_front = (cross * 0.78 + Z_AXIS * 0.47).normalized()
            cross_width = width * 0.91
            if sprig_index in retained_sprig_indices:
                if lod_level >= 4:
                    _sprig_card_single(shape, anchor, tip, width * card_width_scale, slot,
                                       front=front, bend=bend)
                    card_count += 1
                elif lod_level >= 3:
                    _sprig_card(shape, anchor, tip, width * card_width_scale, slot, front=front, bend=bend)
                    card_count += 1
                else:
                    _sprig_card(shape, anchor, tip, width * card_width_scale, slot, front=front, bend=bend)
                    _sprig_card(shape, anchor, tip, cross_width * card_width_scale, slot,
                                front=cross_front, bend=bend)
                    card_count += 2
                card_sprigs += 1
            sprig_index += 1
            has_accent = station == 0 and rng.random() < 0.42
            if has_accent:
                solid_width = rng.uniform(0.045, 0.061)
                solid_slot = rng.choice((5, 6, 7))
                solid_tip = anchor + direction * length * 0.62
                solid_descriptors.append((anchor.copy(), solid_tip.copy(), solid_width, solid_slot,
                                          front.copy(), (bend * 0.5).copy()))

    if lod_level >= 2:
        retained_solid_indices = set()
    elif foliage_density >= 1.0 or len(solid_descriptors) <= 3:
        retained_solid_indices = set(range(len(solid_descriptors)))
    elif foliage_density <= 0.0:
        retained_solid_indices = set()
    else:
        retained_solid_count = max(1, int(round(len(solid_descriptors) * foliage_density)))
        retained_solid_indices = {
            min(len(solid_descriptors) - 1, int(index * len(solid_descriptors) / retained_solid_count))
            for index in range(retained_solid_count)
        }
    for solid_index, descriptor in enumerate(solid_descriptors):
        if solid_index not in retained_solid_indices:
            continue
        anchor, solid_tip, solid_width, solid_slot, front, bend = descriptor
        _leaf(shape, anchor, solid_tip, solid_width, solid_slot, rng,
              front=front, bend=bend, ridge=0.12)
        solid_leaflets += 1
    triangle_count = sum(max(0, len(face) - 2) for face in shape.faces)
    return shape, {"primary_branches": len(primary_records), "secondary_forks": len(secondary_records),
                   "fine_twigs": len(terminal_records), "cutout": True, "cutout_slots": [1, 2, 3, 4],
                   "foliage_density": foliage_density, "lod_level": lod_level,
                   "triangle_count": triangle_count,
                   "recommended_lod_density": (1.0, 0.70, 0.36, 0.36, 0.12)[lod_level],
                   "cards_per_sprig": 1 if lod_level >= 3 else 2,
                   "card_sections": 1 if lod_level >= 4 else 2,
                   "card_solid_counts": {"sprigs_available": total_sprigs, "sprigs": card_sprigs,
                                          "cards": card_count, "solid_leaflets_available": len(solid_descriptors),
                                          "solid_leaflets": solid_leaflets},
                   "crown_form": "broken flat umbrella"}


def _add_pod_core(shape, top, axis, length, radius, slot, seed):
    """Closed, longitudinally UV-mapped lantern body with lobed waxy ribs."""
    rng = random.Random(seed)
    top, axis = _vec(top), _unit(axis)
    _axis, u, v = _frame(axis)
    profile = ((0.0, 0.055), (0.08, 0.16), (0.19, 0.27), (0.35, 0.38),
               (0.52, 0.42), (0.68, 0.39), (0.81, 0.30), (0.91, 0.19), (0.975, 0.085), (1.0, 0.035))
    sides = 20
    vertices, faces, slots, uv_faces, rings = [], [], [], [], []
    phase = rng.uniform(0, TAU)
    for ring_index, (t, r) in enumerate(profile):
        ring = []
        center = top + axis * (length * t) + u * (math.sin(t * math.pi) * radius * 0.035)
        for side_index in range(sides):
            angle = TAU * side_index / sides + phase
            lobes = 1.0 + 0.10 * math.cos(7.0 * angle + phase) + 0.035 * math.sin(3.0 * angle - t)
            point = center + radius * r * lobes * (u * math.cos(angle) + v * math.sin(angle))
            point += axis * (rng.uniform(-0.008, 0.008) * length if ring_index not in (0, len(profile)-1) else 0.0)
            ring.append(len(vertices))
            vertices.append(tuple(point))
        rings.append(ring)
    for ring_index in range(len(profile)-1):
        t0, _ = profile[ring_index]
        t1, _ = profile[ring_index+1]
        for side_index in range(sides):
            nxt = (side_index + 1) % sides
            faces.append((rings[ring_index][side_index], rings[ring_index][nxt],
                          rings[ring_index+1][nxt], rings[ring_index+1][side_index]))
            uv_faces.append(((side_index/sides, t0), ((side_index+1)/sides, t0),
                             ((side_index+1)/sides, t1), (side_index/sides, t1)))
            tone = slot if side_index % 11 else min(4, slot + 1)
            slots.append(tone)
    start_center = len(vertices)
    vertices.append(tuple(top - axis * 0.01))
    end_center = len(vertices)
    vertices.append(tuple(top + axis * length * 1.01))
    for side_index in range(sides):
        nxt = (side_index + 1) % sides
        faces.append((start_center, rings[0][nxt], rings[0][side_index]))
        slots.append(slot)
        uv_faces.append(((0.5, 0.5), (0.5+0.48*math.cos(TAU*nxt/sides), 0.5+0.48*math.sin(TAU*nxt/sides)),
                         (0.5+0.48*math.cos(TAU*side_index/sides), 0.5+0.48*math.sin(TAU*side_index/sides))))
        faces.append((end_center, rings[-1][side_index], rings[-1][nxt]))
        slots.append(min(7, slot + 1))
        uv_faces.append(((0.5, 0.5), (0.5+0.48*math.cos(TAU*side_index/sides), 0.5+0.48*math.sin(TAU*side_index/sides)),
                         (0.5+0.48*math.cos(TAU*nxt/sides), 0.5+0.48*math.sin(TAU*nxt/sides))))
    shape.add_component(vertices, faces, slots, smooth=True, uv_faces=uv_faces)


def _lantern_pod(shape, attach, direction, scale, rng, pod_index):
    attach, axis = _vec(attach), _unit(direction)
    length = scale
    radius = scale * rng.uniform(0.23, 0.29)
    side = axis.cross(Z_AXIS)
    if side.length < 1e-6:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    sway = rng.uniform(-0.045, 0.045)
    pod_top = attach + axis * 0.11
    shape.tube([tuple(attach - axis * 0.02), tuple(attach + axis * 0.06 + side*sway),
                tuple(pod_top + axis*0.05 + side*sway*0.6)], [0.025, 0.019, 0.013], slot=0, sides=7, smooth=True)
    _add_pod_core(shape, pod_top, axis, length, radius, 3, 8100 + pod_index)

    # Individual waxy panels wrap the long core. Their slight radial curl keeps
    # the pod petalled and ribbed instead of reading as a smooth oval.
    petal_count = 7
    for petal_index in range(petal_count):
        angle = TAU * petal_index / petal_count + rng.uniform(-0.06, 0.06)
        radial = (side * math.cos(angle) + axis.cross(side).normalized() * math.sin(angle)).normalized()
        base = pod_top + axis * (length * 0.09) + radial * radius * 0.10
        tip = pod_top + axis * (length * 0.95) + radial * radius * rng.uniform(0.12, 0.24)
        _leaf(shape, base, tip, radius * rng.uniform(0.66, 0.82), rng.choice((2, 3, 3, 4, 4)), rng,
              front=radial, bend=radial * radius * 0.14 + side * sway, thickness=radius * 0.13, ridge=0.20)
        # Fine raised keels continue the petal midrib down the waxy surface.
        rib_path = []
        for step in range(5):
            t = 0.12 + step * 0.19
            center = base.lerp(tip, t) + radial * (radius * (0.12 + 0.18 * math.sin(math.pi*t)))
            rib_path.append(tuple(center))
        shape.tube(rib_path, [0.010, 0.009, 0.007, 0.005, 0.0018], slot=6, sides=5, smooth=True)

    # Star calyx: five narrow sepals form the anatomical attachment below the
    # recurved pedicel and contrast with the warm inner panels.
    for sepal in range(5):
        angle = TAU * sepal / 5 + pod_index * 0.19
        radial = (side * math.cos(angle) + axis.cross(side).normalized() * math.sin(angle)).normalized()
        base = pod_top - axis * 0.025 + radial * radius * 0.16
        tip = base - axis * length * 0.22 + radial * radius * 0.55 + Z_AXIS * radius * 0.12
        _leaf(shape, base, tip, radius * 0.34, (2, 3, 4)[sepal % 3], rng, front=radial,
              bend=radial * radius * 0.08, thickness=radius * 0.08, ridge=0.12)
    return {"petals": petal_count, "sepals": 5}


def build_alien_lantern(seed=2323):
    """Organic fibrous stalks, basal foliage, and ribbed hanging lantern flowers."""
    shape = Shape()
    rng = random.Random(seed)
    stalk_records = []
    stalk_count = 7
    for stalk_index in range(stalk_count):
        angle = TAU * stalk_index / stalk_count + rng.uniform(-0.16, 0.16)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        tangent = Vector((-radial.y, radial.x, 0.0))
        reach = rng.uniform(0.34, 0.70)
        height = rng.uniform(2.18, 2.88)
        start = Vector((0.0, 0.0, 0.06))
        end = radial * reach + Z_AXIS * height
        path = _curve_between(start, end, lift=height * rng.uniform(0.12, 0.25), sway=reach * 0.28, samples=8, side=tangent)
        base_radius = rng.uniform(0.055, 0.080)
        shape.tube(path, [base_radius, base_radius*0.87, base_radius*0.74, base_radius*0.62,
                          base_radius*0.49, base_radius*0.36, base_radius*0.20, 0.009], slot=0, sides=9, smooth=True)
        stalk_records.append((path, radial, tangent, base_radius, angle, stalk_index))

    # Low leaves spread from the fibrous crown instead of forming a smooth orb.
    leaf_count = 0
    for leaf_index in range(24):
        angle = TAU * leaf_index / 24 + rng.uniform(-0.09, 0.09)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        base = radial * rng.uniform(0.05, 0.25) + Z_AXIS * rng.uniform(0.12, 0.34)
        length = rng.uniform(0.75, 1.23)
        tip = base + radial * length + Z_AXIS * rng.uniform(0.10, 0.38)
        _leaf(shape, base, tip, rng.uniform(0.20, 0.32), rng.choice((5, 5, 5, 6, 6)), rng,
              front=(radial*0.30 + Z_AXIS*0.95).normalized(), bend=radial*rng.uniform(0.02, 0.12), ridge=0.15)
        leaf_count += 1

    branch_records = []
    for path, radial, tangent, radius, angle, stalk_index in stalk_records:
        for node in range(3):
            t = 0.40 + node * 0.22 + rng.uniform(-0.025, 0.025)
            start = _path_point(path, t)
            sign = -1 if (node + stalk_index) % 2 else 1
            direction = (radial*0.78 + tangent*sign*rng.uniform(0.12, 0.30) + Z_AXIS*rng.uniform(0.28, 0.50)).normalized()
            length = rng.uniform(0.40, 0.72)
            end = start + direction * length
            branch = _curve_between(start, end, lift=length*0.10, sway=length*0.08, samples=6, side=tangent)
            branch_radius = radius * 0.48
            shape.tube(branch, [branch_radius, branch_radius*0.78, branch_radius*0.57, branch_radius*0.34,
                                branch_radius*0.17, 0.0035], slot=0, sides=6, smooth=True)
            branch_records.append((branch, direction, radial, tangent, angle, stalk_index))

    # Secondary tendrils carry leaves and a few pods; they curve in several
    # planes and stay attached to the visible trunk network.
    tendril_records = []
    for branch, direction, radial, tangent, angle, stalk_index in branch_records:
        for fork in (0, 1):
            t = 0.48 + fork * 0.31
            start = _path_point(branch, t)
            sign = -1 if fork == 0 else 1
            sub_direction = (direction*0.67 + tangent*sign*0.50 + Z_AXIS*rng.uniform(0.02, 0.19)).normalized()
            length = rng.uniform(0.26, 0.44)
            end = start + sub_direction * length
            twig = _curve_between(start, end, lift=length*0.08, sway=length*0.06, samples=4, side=tangent)
            shape.tube(twig, [0.013, 0.010, 0.006, 0.0018], slot=0, sides=5, smooth=True)
            tendril_records.append((twig, sub_direction, radial, tangent, angle + sign*0.25, stalk_index))

    for twig, axis, radial, tangent, angle, stalk_index in tendril_records:
        for station in (0.22, 0.46, 0.70, 0.90):
            base = _path_point(twig, station)
            sign = -1 if rng.random() < 0.5 else 1
            leaf_axis = (axis*0.28 + tangent*sign*0.70 + Z_AXIS*rng.uniform(-0.03, 0.20)).normalized()
            tip = base + leaf_axis*rng.uniform(0.20, 0.34)
            _leaf(shape, base, tip, rng.uniform(0.085, 0.135), rng.choice((5, 5, 6, 6, 6)), rng,
                  front=(radial*0.64 + Z_AXIS*0.54).normalized(), bend=radial*rng.uniform(-0.03, 0.05), ridge=0.14)
            leaf_count += 1

    pod_records = []
    # Eight mature pods hang from the tallest stalks and lateral arching forks.
    for pod_index in range(8):
        stalk = stalk_records[pod_index % len(stalk_records)]
        path, radial, tangent, _radius, angle, _stalk_index = stalk
        if pod_index < stalk_count:
            attach = _path_point(path, rng.uniform(0.69, 0.89))
        else:
            branch = branch_records[(pod_index * 5 + 3) % len(branch_records)][0]
            attach = _path_point(branch, rng.uniform(0.62, 0.90))
        pod_direction = (Vector((radial.x*0.18, radial.y*0.18, -1.0)) + tangent*rng.uniform(-0.08, 0.08)).normalized()
        scale = rng.uniform(0.46, 0.61)
        detail = _lantern_pod(shape, attach, pod_direction, scale, rng, pod_index)
        pod_records.append(detail)

    return shape, {"curved_stalks": stalk_count, "branch_forks": len(branch_records), "fine_tendrils": len(tendril_records),
                   "leaves": leaf_count, "ribbed_lantern_pods": len(pod_records), "petals_per_pod": 7}


def build_ribbon_fern(seed=2339):
    """Pinnate violet fern with curved rachides and hundreds of paired pinnae."""
    shape = Shape()
    rng = random.Random(seed)
    # A low, arched rhizome and a few fibrous roots anchor the crowded crown.
    rhizome_path = [(0.0, -0.12, 0.07), (0.04, -0.03, 0.12), (0.09, 0.05, 0.10), (0.13, 0.15, 0.065)]
    shape.tube(rhizome_path, [0.10, 0.085, 0.055, 0.012], slot=0, sides=9, smooth=True)
    for root_index in range(7):
        angle = TAU*root_index/7 + rng.uniform(-0.14, 0.14)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        tangent = Vector((-radial.y, radial.x, 0.0))
        length = rng.uniform(0.32, 0.58)
        path = [(0.06, 0.0, 0.12), tuple(radial*length*0.42 + tangent*rng.uniform(-0.04, 0.04) + Vector((0,0,0.08))),
                tuple(radial*length*0.76 + tangent*rng.uniform(-0.05, 0.05) + Vector((0,0,0.035))),
                tuple(radial*length + Vector((0,0,0.01)))]
        shape.tube(path, [0.072, 0.046, 0.023, 0.004], slot=0, sides=6, smooth=True)

    frond_count = 10
    leaflet_count = 0
    for frond_index in range(frond_count):
        angle = TAU*frond_index/frond_count + rng.uniform(-0.15, 0.15)
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        lateral = Vector((-radial.y, radial.x, 0.0))
        reach = rng.uniform(1.75, 2.35)
        height = rng.uniform(1.45, 2.05)
        p0 = Vector((0.03, 0.02, 0.11))
        p1 = radial*reach*0.28 + Z_AXIS*height*0.86
        p2 = radial*reach*0.68 + Z_AXIS*height*1.10 + lateral*rng.uniform(-0.10,0.10)
        p3 = radial*reach + Z_AXIS*height*0.62 + lateral*rng.uniform(-0.12,0.12)
        path = _sample_cubic(p0, p1, p2, p3, count=15)
        base_radius = rng.uniform(0.022, 0.030)
        radii = [base_radius*(1.0-t*0.92) for t in [i/14 for i in range(15)]]
        shape.tube(path, radii, slot=0, sides=7, smooth=True)

        pair_count = 27
        for pair_index in range(pair_count):
            t = 0.075 + pair_index*0.0325 + rng.uniform(-0.006,0.006)
            anchor = _path_point(path, t)
            before = _path_point(path, max(0.0, t-0.018))
            after = _path_point(path, min(0.999, t+0.018))
            rachis_tangent = _unit(after-before, radial)
            pair_length = (0.42 * math.sin(math.pi*t)**0.78 * (1.0-0.28*t) + 0.055) * rng.uniform(0.84,1.16)
            pair_length *= 0.84 + 0.18*math.sin(frond_index*1.7+t*4.0)
            for sign in (-1, 1):
                leaf_axis = (lateral*sign*0.86 + rachis_tangent*0.34 + radial*0.10).normalized()
                tip = anchor + leaf_axis*pair_length
                blade_width = pair_length*rng.uniform(0.19,0.25)
                face_front = (radial*0.88 + Z_AXIS*0.36).normalized()
                # Preserve the old random-stream step, but derive color from
                # frond position so adjacent pinnae form a violet-to-teal wash.
                rng.choice((2,3,3,4,5,6,7))
                color_position = max(0.0, min(1.0, t + (((frond_index * 3) % 7) - 3) * 0.018))
                if color_position < 0.20:
                    leaf_slot = 1
                elif color_position < 0.40:
                    leaf_slot = 2
                elif color_position < 0.63:
                    leaf_slot = 3
                elif color_position < 0.84:
                    leaf_slot = 4
                else:
                    leaf_slot = 5
                _leaf(shape, anchor, tip, blade_width, leaf_slot, rng,
                      front=face_front, bend=rachis_tangent*pair_length*0.09 + Z_AXIS*pair_length*0.025,
                      thickness=max(blade_width*0.11,0.005), ridge=0.18)
                leaflet_count += 1

    # Two younger croziers curl up from the crown, giving the plant a living
    # center between its mature pinnate fans.
    for curl_index in range(2):
        angle = 0.7 + curl_index*2.6
        radial = Vector((math.cos(angle),math.sin(angle),0.0))
        lateral = Vector((-radial.y,radial.x,0.0))
        points = []
        for step in range(13):
            t = step/12
            theta = -math.pi*1.45 + t*math.pi*1.45
            center = radial*(0.20 + 0.23*math.cos(theta)) + lateral*(0.23*math.sin(theta)) + Z_AXIS*(0.14 + t*0.75)
            points.append(tuple(center))
        shape.tube(points, [0.018*(1-i/13) for i in range(13)], slot=0, sides=6, smooth=True)
    return shape, {"mature_fronds": frond_count, "paired_pinnae": leaflet_count, "young_croziers": 2}


def _polyp_cup(shape, base, direction, radius, height, slot):
    """Small closed raised corallite cup with an actual recessed inner bowl."""
    base, axis = _vec(base), _unit(direction)
    _axis, u, v = _frame(axis)
    sides = 9
    levels = ((0.0, radius*0.45), (0.58, radius*0.76), (1.0, radius), (0.91, radius*0.70), (0.34, radius*0.28))
    vertices, faces, ring_ids, slots = [], [], [], []
    for level_index, (t, r) in enumerate(levels):
        ring=[]
        for side_index in range(sides):
            angle=TAU*side_index/sides + 0.13*level_index
            point=base + axis*(height*t) + r*(u*math.cos(angle)+v*math.sin(angle))
            ring.append(len(vertices)); vertices.append(tuple(point))
        ring_ids.append(ring)
    for level_index in range(len(levels)-1):
        for side_index in range(sides):
            nxt=(side_index+1)%sides
            faces.append((ring_ids[level_index][side_index],ring_ids[level_index][nxt],
                          ring_ids[level_index+1][nxt],ring_ids[level_index+1][side_index]))
            slots.append(slot if level_index < 3 else 6)
    bottom=len(vertices); vertices.append(tuple(base-axis*0.006))
    for side_index in range(sides):
        nxt=(side_index+1)%sides
        faces.append((bottom,ring_ids[0][nxt],ring_ids[0][side_index])); slots.append(slot)
    bowl=len(vertices); vertices.append(tuple(base+axis*(height*0.25)))
    for side_index in range(sides):
        nxt=(side_index+1)%sides
        faces.append((bowl,ring_ids[-1][side_index],ring_ids[-1][nxt])); slots.append(6)
    shape.add_component(vertices,faces,slots,smooth=False)


def build_coral_fan(seed=2351):
    """Open anastomosing roseglass fan with tapered limbs and raised polyp cups."""
    shape = Shape()
    rng = random.Random(seed)
    primary_records=[]
    primary_count=10
    # Staggered rootlets widen into a natural fan. Each primary follows a curved
    # route and bends independently rather than repeating a binary fork motif.
    for index in range(primary_count):
        s=(index/(primary_count-1))*2.0-1.0
        start=Vector((s*0.46, rng.uniform(-0.10,0.10), 0.055))
        target_x=s*2.02 + rng.uniform(-0.22,0.22)
        target_z=rng.uniform(2.22,3.10) * (1.0-0.12*abs(s))
        end=Vector((target_x, rng.uniform(-0.22,0.22), target_z))
        side=Vector((-s,0.0,0.0))
        path=_curve_between(start,end,lift=rng.uniform(0.18,0.54),sway=rng.uniform(-0.22,0.22),samples=9,side=Vector((0,1,0)))
        base_radius=rng.uniform(0.060,0.082)*(1.0-0.12*abs(s))
        primary_radii = [base_radius * (1.0 - 0.94 * (i / 8.0) ** 1.25) for i in range(9)]
        shape.tube(path,primary_radii,slot=2,sides=10,smooth=True)
        # Short dark holdfasts occupy only the root base; the fan itself keeps
        # its continuous coral tissue color instead of reading as black wire.
        root_start = Vector((s * 0.24, -0.015, 0.035))
        root_mid = root_start.lerp(path[0], 0.54) + Vector((0.0, -0.012, 0.004))
        root_radius = base_radius * 0.56
        shape.tube([tuple(root_start), tuple(root_mid), path[0]],
                   [root_radius, root_radius * 0.76, base_radius * 0.54],
                   slot=0,sides=7,smooth=True)
        primary_records.append((path,s,base_radius,index))

    secondary_records=[]
    for path,s,base_radius,index in primary_records:
        branch_count=rng.randint(4,6)
        for branch_index in range(branch_count):
            t=rng.uniform(0.22,0.88)
            start=_path_point(path,t)
            outward_sign=1 if s < 0 else -1
            if abs(s)<0.28:
                outward_sign=rng.choice((-1,1))
            sideways=Vector((outward_sign*rng.uniform(0.28,0.65),rng.uniform(-0.10,0.10),0.0))
            direction=(Vector((s*0.24,0.0,rng.uniform(0.45,0.82)))+sideways).normalized()
            length=rng.uniform(0.48,0.92)*(1.0-0.18*abs(s))
            end=start+direction*length+Vector((sideways.x*length*0.18, rng.uniform(-0.12,0.12),0.0))
            branch=_curve_between(start,end,lift=length*rng.uniform(0.08,0.22),sway=length*0.12,samples=6,side=Vector((0,1,0)))
            radius=base_radius*rng.uniform(0.44,0.60)
            shape.tube(branch,[radius,radius*0.77,radius*0.58,radius*0.38,radius*0.20,0.003],slot=3,sides=8,smooth=True)
            secondary_records.append((branch,s,outward_sign,index,branch_index,radius))

    tertiary_records=[]
    for path,s,sign,index,branch_index,radius in secondary_records:
        child_count=rng.randint(1,3)
        for child in range(child_count):
            t=rng.uniform(0.44,0.90)
            start=_path_point(path,t)
            direction=(Vector((sign*rng.uniform(0.20,0.60),0.0,rng.uniform(0.42,0.82))) + Vector((s*0.15,rng.uniform(-0.12,0.12),0))).normalized()
            length=rng.uniform(0.28,0.58)
            end=start+direction*length
            twig=_curve_between(start,end,lift=length*0.12,sway=rng.uniform(-0.07,0.07),samples=5,side=Vector((0,1,0)))
            twig_radius=max(radius*rng.uniform(0.43,0.56),0.006)
            twig_slot = 4 if (index + branch_index + child) % 4 == 0 else 2
            shape.tube(twig,[twig_radius,twig_radius*0.72,twig_radius*0.48,twig_radius*0.25,0.0018],slot=twig_slot,sides=7,smooth=True)
            tertiary_records.append((twig,s,sign,index,branch_index,child,twig_radius))

    # Irregular side loops stitch neighboring primaries and secondaries into a
    # living anastomosing network with open cells of different sizes.
    link_count=0
    for pair_index in range(primary_count-1):
        left_path=primary_records[pair_index][0]
        right_path=primary_records[pair_index+1][0]
        if rng.random()<0.82:
            t=rng.uniform(0.31,0.49)
            t2=min(0.84,t+rng.uniform(0.20,0.35))
            start=_path_point(left_path,t)
            end=_path_point(right_path,t2)
            link=_curve_between(start,end,lift=rng.uniform(0.05,0.22),sway=rng.uniform(-0.06,0.06),samples=5,side=Vector((0,1,0)))
            radius=rng.uniform(0.010,0.018)
            shape.tube(link,[radius,radius*0.84,radius*0.62,radius*0.36,0.002],slot=2,sides=6,smooth=True)
            link_count+=1
        if pair_index%2==0:
            start=_path_point(left_path,rng.uniform(0.58,0.78))
            end=_path_point(right_path,rng.uniform(0.67,0.89))
            link=_curve_between(start,end,lift=rng.uniform(0.12,0.30),sway=rng.uniform(-0.05,0.05),samples=5,side=Vector((0,1,0)))
            radius=rng.uniform(0.008,0.014)
            shape.tube(link,[radius,radius*0.82,radius*0.58,radius*0.31,0.0018],slot=2,sides=6,smooth=True)
            link_count+=1
        if pair_index in (1, 4, 7):
            start=_path_point(left_path,rng.uniform(0.39,0.62))
            end=_path_point(right_path,rng.uniform(0.68,0.90))
            link=_curve_between(start,end,lift=rng.uniform(0.08,0.24),sway=rng.uniform(-0.08,0.08),samples=5,side=Vector((0,1,0)))
            radius=rng.uniform(0.010,0.015)
            shape.tube(link,[radius,radius*0.82,radius*0.58,radius*0.31,0.0018],slot=3,sides=5,smooth=True)
            link_count+=1

    all_branches=[record[0] for record in primary_records]
    all_branches.extend(record[0] for record in secondary_records)
    all_branches.extend(record[0] for record in tertiary_records)
    cup_count=0
    # Raised calices are distributed over stems and branchlets, with their
    # openings facing the light and the front of the fan.
    for branch_index,path in enumerate(all_branches):
        cups_on_branch=2 if branch_index < primary_count or branch_index % 4 == 0 else 1
        for cup_index in range(cups_on_branch):
            t=0.24+cup_index*(0.56/max(1,cups_on_branch-1))+rng.uniform(-0.035,0.035)
            base=_path_point(path,t)
            tangent=_unit(_path_point(path,min(0.99,t+0.025))-_path_point(path,max(0.01,t-0.025)),Z_AXIS)
            outward=Vector((rng.uniform(-0.40,0.40),-1.0,rng.uniform(0.28,0.80)))
            outward=outward-tangent*outward.dot(tangent)
            outward=_unit(outward,Vector((0,-1,0)))
            base=base+outward*rng.uniform(0.018,0.044)
            radius=rng.uniform(0.028,0.050)*(0.82 if branch_index>=primary_count else 1.0)
            cup_tone = rng.choice((2,3,3,5,6,7))
            cup_slot = 5 if cup_tone in (2,3,5) else 6
            _polyp_cup(shape,base,outward,radius,rng.uniform(0.045,0.078),cup_slot)
            cup_count+=1

    return shape,{"primary_limbs":len(primary_records),"secondary_branches":len(secondary_records),
                  "terminal_branchlets":len(tertiary_records),"anastomosing_links":link_count,
                  "polyp_cups":cup_count,"form":"open irregular fan"}


LAYERED_SANDSTONE_PALETTE = ["#50392f", "#a36b49", "#b27953", "#be865d", "#ca9368", "#d2a078", "#c4906d", "#d8ae81"]
GLACIAL_SHARD_PALETTE = ["#436f80", "#75aabb", "#83b6c5", "#92c1ce", "#a4ccd6", "#c4e0e4", "#afd1db", "#e6f0ec"]
UMBRELLA_TREE_PALETTE = ["#725339", "#456344", "#688444", "#88a54b", "#afba65", "#494e36", "#bfa677", "#d1d387"]
ALIEN_LANTERN_PALETTE = ["#294752", "#3b6a71", "#ecaa42", "#ef794b", "#df566f", "#278d87", "#59b69d", "#f6d382"]
RIBBON_FERN_PALETTE = ["#332e4d", "#544679", "#775796", "#446c97", "#48959d", "#80beb6", "#7f78aa", "#9dc9bd"]
CORAL_FAN_PALETTE = ["#452e49", "#69425d", "#99556d", "#c77882", "#b86b7b", "#e9a3aa", "#f2c7b5", "#d4918e"]

DEFINITIONS = (
    ("layered_sandstone", "Wind-carved sandstone", "Warm sedimentary layers and a weathered crown.", "rock", build_layered_sandstone, LAYERED_SANDSTONE_PALETTE),
    ("glacial_shard", "Blue glacial shards", "A cluster of opaque blue ice-like mineral splinters.", "rock", build_glacial_shard, GLACIAL_SHARD_PALETTE),
    ("umbrella_tree", "Savanna umbrella", "An open branching trunk under a broad dappled canopy.", "tree", build_umbrella_tree, UMBRELLA_TREE_PALETTE),
    ("alien_lantern", "Amber lantern plant", "Ribbed jewel pods hang above a turquoise basal rosette.", "alien", build_alien_lantern, ALIEN_LANTERN_PALETTE),
    ("ribbon_fern", "Violet ribbon fern", "Spiraling indigo fronds with feathered cyan edges.", "alien", build_ribbon_fern, RIBBON_FERN_PALETTE),
    ("coral_fan", "Roseglass coral fan", "A branching land coral with pale rose terminal buds.", "alien", build_coral_fan, CORAL_FAN_PALETTE),
)
