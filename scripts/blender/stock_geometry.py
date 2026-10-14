"""Original, UV-mapped geometry builders for the Orbit Foundry stock library.

This module is imported from Blender's Python console/MCP.  It intentionally
uses only Blender's bundled Python API and procedural meshes: no downloaded or
generated assets are needed.
"""
import math
import random
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


TAU = math.tau
ATLAS_COLUMNS = 4
ATLAS_ROWS = 2
ATLAS_INSET = 0.02
ATLAS_COVERAGE = 0.96


def atlas_uv(slot, u, v):
    """Map normalized component UVs into one of eight 2%-inset atlas tiles."""
    u = min(1.0, max(0.0, float(u)))
    v = min(1.0, max(0.0, float(v)))
    return (
        (slot % ATLAS_COLUMNS + ATLAS_INSET + ATLAS_COVERAGE * u) / ATLAS_COLUMNS,
        (slot // ATLAS_COLUMNS + ATLAS_INSET + ATLAS_COVERAGE * v) / ATLAS_ROWS,
    )


def _as_vector(value):
    return value.copy() if isinstance(value, Vector) else Vector(value)


def _projected_face_uvs(vertices, faces):
    """Per-face planar projection using the dominant normal axis.

    Bounds are shared by the entire closed component, so facets keep a useful
    spatial relationship to the eventual atlas texture instead of restarting
    the same triangle patch on every polygon.
    """
    bounds = []
    for axis in range(3):
        values = [float(v[axis]) for v in vertices]
        bounds.append((min(values), max(values)))
    output = []
    for face in faces:
        if len(face) >= 3:
            a, b, c = (_as_vector(vertices[face[i]]) for i in range(3))
            normal = (b - a).cross(c - a)
        else:
            normal = Vector((0.0, 0.0, 1.0))
        drop = max(range(3), key=lambda axis: abs(normal[axis]))
        axes = [axis for axis in range(3) if axis != drop]
        face_uv = []
        for index in face:
            point = vertices[index]
            coords = []
            for axis in axes:
                lo, hi = bounds[axis]
                span = max(hi - lo, 1e-6)
                coords.append((float(point[axis]) - lo) / span)
            face_uv.append((coords[0], coords[1]))
        output.append(face_uv)
    return output


class Shape:
    """Mesh accumulator retaining semantic material slots and loop UVs."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.material_indices = []
        self.smooth = []
        self.face_uvs = []

    def add_component(self, vertices, faces, slots, smooth=False, uv_faces=None):
        if not vertices or not faces:
            return
        vertices = [tuple(_as_vector(v)) for v in vertices]
        start = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(start + int(i) for i in face) for face in faces)
        if isinstance(slots, int):
            self.material_indices.extend([slots] * len(faces))
        else:
            self.material_indices.extend(int(slot) for slot in slots)
        if isinstance(smooth, bool):
            self.smooth.extend([smooth] * len(faces))
        else:
            self.smooth.extend(bool(value) for value in smooth)
        if uv_faces is None:
            uv_faces = _projected_face_uvs(vertices, faces)
        for slot, face_uv in zip(
            [slots] * len(faces) if isinstance(slots, int) else slots, uv_faces
        ):
            self.face_uvs.append([atlas_uv(int(slot), u, v) for u, v in face_uv])

    def tube(self, path, radii, slot=0, sides=8, smooth=True):
        """Add a capped swept tube with circumferential U and lengthwise V."""
        path = [_as_vector(point) for point in path]
        radii = [max(float(radius), 0.0008) for radius in radii]
        if len(path) < 2 or len(path) != len(radii):
            raise ValueError("tube path and radii must have the same length >= 2")
        sides = max(3, int(sides))
        tangents = []
        for i in range(len(path)):
            if i == 0:
                tangent = path[1] - path[0]
            elif i == len(path) - 1:
                tangent = path[-1] - path[-2]
            else:
                tangent = path[i + 1] - path[i - 1]
            tangents.append(tangent.normalized() if tangent.length > 1e-8 else Vector((0, 0, 1)))

        reference = Vector((0, 0, 1))
        if abs(tangents[0].dot(reference)) > 0.92:
            reference = Vector((0, 1, 0))
        normal = tangents[0].cross(reference).normalized()
        binormal = tangents[0].cross(normal).normalized()
        frames = [(normal, binormal)]
        previous_tangent = tangents[0]
        for tangent in tangents[1:]:
            turn = previous_tangent.rotation_difference(tangent)
            normal = turn @ normal
            normal = (normal - tangent * normal.dot(tangent)).normalized()
            if normal.length < 1e-8:
                reference = Vector((0, 1, 0)) if abs(tangent.y) < 0.92 else Vector((1, 0, 0))
                normal = tangent.cross(reference).normalized()
            binormal = tangent.cross(normal).normalized()
            frames.append((normal, binormal))
            previous_tangent = tangent

        cumulative = [0.0]
        for i in range(1, len(path)):
            cumulative.append(cumulative[-1] + (path[i] - path[i - 1]).length)
        total_length = max(cumulative[-1], 1e-6)
        vertices = []
        for ring, (center, radius, frame) in enumerate(zip(path, radii, frames)):
            axis_u, axis_v = frame
            for side in range(sides):
                angle = side * TAU / sides
                point = center + radius * (math.cos(angle) * axis_u + math.sin(angle) * axis_v)
                vertices.append(tuple(point))

        faces = []
        uv_faces = []
        for ring in range(len(path) - 1):
            v0 = cumulative[ring] / total_length
            v1 = cumulative[ring + 1] / total_length
            for side in range(sides):
                next_side = (side + 1) % sides
                u0 = side / sides
                u1 = (side + 1) / sides
                a = ring * sides + side
                b = ring * sides + next_side
                c = (ring + 1) * sides + next_side
                d = (ring + 1) * sides + side
                faces.append((a, b, c, d))
                uv_faces.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1)))

        start_face = tuple(reversed(range(sides)))
        end_face = tuple((len(path) - 1) * sides + i for i in range(sides))
        faces.extend((start_face, end_face))
        uv_faces.append(tuple((0.5 + 0.5 * math.cos(TAU * i / sides), 0.5 + 0.5 * math.sin(TAU * i / sides)) for i in reversed(range(sides))))
        uv_faces.append(tuple((0.5 + 0.5 * math.cos(TAU * i / sides), 0.5 + 0.5 * math.sin(TAU * i / sides)) for i in range(sides)))
        self.add_component(vertices, faces, slot, smooth, uv_faces)

    def cone(self, base, tip, base_radius, slot=0, sides=7, rings=4, smooth=True):
        """Add a closed, slightly irregular tapered cone by sweeping rings."""
        base = _as_vector(base)
        tip = _as_vector(tip)
        axis = tip - base
        if axis.length < 1e-7:
            return
        axis.normalize()
        ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((0, 1, 0))
        u = axis.cross(ref).normalized()
        v = axis.cross(u).normalized()
        path = []
        radii = []
        for j in range(rings + 1):
            t = j / rings
            center = base.lerp(tip, t)
            center += u * (math.sin(math.pi * t) * base_radius * 0.09)
            path.append(tuple(center))
            radii.append(max(base_radius * (1.0 - t) ** 0.82, 0.0015))
        self.tube(path, radii, slot=slot, sides=sides, smooth=smooth)

    def tetra_needle(self, base, tip, radius, slot):
        """Add one closed tetrahedral needle with base-to-tip UV coordinates."""
        base = _as_vector(base)
        tip = _as_vector(tip)
        direction = tip - base
        if direction.length < 1e-7:
            return
        direction.normalize()
        reference = Vector((0, 0, 1))
        if abs(direction.dot(reference)) > 0.92:
            reference = Vector((0, 1, 0))
        axis_u = direction.cross(reference).normalized()
        axis_v = direction.cross(axis_u).normalized()
        vertices = [
            tuple(base + axis_u * radius),
            tuple(base - axis_u * (radius * 0.5) + axis_v * (radius * 0.8660254)),
            tuple(base - axis_u * (radius * 0.5) - axis_v * (radius * 0.8660254)),
            tuple(tip),
        ]
        faces = [(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)]
        base_uv = ((0.16, 0.015), (0.84, 0.015), (0.50, 0.22))
        tip_uv = (0.50, 0.985)
        uv_faces = [
            (base_uv[0], base_uv[2], base_uv[1]),
            (base_uv[0], base_uv[1], tip_uv),
            (base_uv[1], base_uv[2], tip_uv),
            (base_uv[2], base_uv[0], tip_uv),
        ]
        self.add_component(vertices, faces, slot, smooth=False, uv_faces=uv_faces)

    def sprig_card(self, base, tip, width, slot, roll=0.0, curve=0.045, sections=3):
        """Add a gently bent, explicitly double-sided cutout sprig card.

        Local U spans the sprig width and local V runs from its base (0) to
        its tip (1).  Three curved sections make the surface read as foliage
        in the live preview while retaining a simple atlas alpha silhouette.
        """
        base = _as_vector(base)
        tip = _as_vector(tip)
        axis = tip - base
        if axis.length < 1e-7:
            return
        axis.normalize()
        reference = Vector((0.0, 0.0, 1.0))
        if abs(axis.dot(reference)) > 0.92:
            reference = Vector((0.0, 1.0, 0.0))
        across = axis.cross(reference).normalized()
        across = Quaternion(axis, float(roll)) @ across
        normal = axis.cross(across).normalized()

        sections = max(1, int(sections))
        fractions = tuple(i / sections for i in range(sections + 1))
        # The atlas alpha carries the tapered silhouette.  Keep its underlying
        # card nearly rectangular to avoid tapering the sprig twice.
        width_knots = ((0.0, 0.82), (1.0 / 3.0, 1.0), (2.0 / 3.0, 0.94), (1.0, 0.80))
        width_factors = []
        for t in fractions:
            for (t0, w0), (t1, w1) in zip(width_knots, width_knots[1:]):
                if t <= t1 + 1e-8:
                    mix = (t - t0) / max(1e-8, t1 - t0)
                    width_factors.append(w0 * (1.0 - mix) + w1 * mix)
                    break
            else:
                width_factors.append(width_knots[-1][1])
        vertices = []
        for t, width_factor in zip(fractions, width_factors):
            center = base.lerp(tip, t)
            center += normal * (math.sin(math.pi * t) * curve)
            center += across * (math.sin(math.pi * t) * curve * 0.20)
            half_width = float(width) * width_factor * 0.5
            vertices.extend((tuple(center - across * half_width), tuple(center + across * half_width)))

        faces = []
        uv_faces = []
        for section in range(len(fractions) - 1):
            a = section * 2
            b = a + 1
            c = a + 3
            d = a + 2
            v0, v1 = fractions[section], fractions[section + 1]
            front_uv = ((0.0, v0), (0.0, v1), (1.0, v1), (1.0, v0))
            # One authored face renders from both sides.  The order below
            # points along axis×across; cutout material disables culling.
            faces.append((a, d, c, b))
            uv_faces.append(front_uv)
        self.add_component(vertices, faces, slot, smooth=False, uv_faces=uv_faces)


def _sample_cubic(p0, p1, p2, p3, count=5):
    p0, p1, p2, p3 = map(_as_vector, (p0, p1, p2, p3))
    output = []
    for i in range(count):
        t = i / (count - 1)
        s = 1.0 - t
        point = p0 * (s ** 3) + p1 * (3 * s * s * t) + p2 * (3 * s * t * t) + p3 * (t ** 3)
        output.append(tuple(point))
    return output


def _path_point(path, t):
    path = [_as_vector(point) for point in path]
    at = min(len(path) - 1.000001, max(0.0, t * (len(path) - 1)))
    i = int(at)
    return path[i].lerp(path[i + 1], at - i)


def _branch_path(start, outward, length, rise, droop, lateral=0.0, samples=5):
    start = _as_vector(start)
    outward = _as_vector(outward).normalized()
    side = Vector((-outward.y, outward.x, 0.0))
    end = start + outward * length + Vector((0, 0, length * (rise - droop))) + side * lateral
    c1 = start + outward * (length * 0.28) + Vector((0, 0, length * (rise * 0.75)))
    c2 = start + outward * (length * 0.72) + Vector((0, 0, length * (rise - droop * 0.48))) + side * (lateral * 0.6)
    return _sample_cubic(start, c1, c2, end, samples)


def build_wind_pine(seed=581, foliage_density=1.0, lod_level=0):
    """Wind-bent pine with deterministic, structure-aware native LOD levels.

    LOD0 retains the authored branching tree. Far levels progressively simplify
    wood sweeps and their foliage cards while preserving the crown envelope.
    """
    lod_level = min(4, max(0, int(lod_level)))
    foliage_density = min(1.0, max(0.02, float(foliage_density)))
    shape = Shape()
    rng = random.Random(seed)
    z_axis = Vector((0, 0, 1))
    trunk_path = [
        (0.00, 0.00, 0.00), (0.04, 0.00, 0.75), (0.09, 0.01, 1.55),
        (0.18, 0.02, 2.45), (0.29, 0.03, 3.45), (0.39, 0.04, 4.50),
        (0.49, 0.05, 5.55), (0.59, 0.055, 6.48), (0.66, 0.04, 6.86),
    ]
    trunk_radii = [0.31, 0.265, 0.226, 0.190, 0.158, 0.126, 0.094, 0.061, 0.036]

    def reduced_profile(path, radii, count):
        if len(path) <= count:
            return path, radii
        picks = sorted({round(i * (len(path) - 1) / (count - 1)) for i in range(count)})
        return [path[i] for i in picks], [radii[i] for i in picks]

    def add_wood(path, radii, slot=0, sides=6, smooth=True, kind="twig", retain=True):
        if not retain:
            return
        if kind == "root" and lod_level >= 2:
            return
        if kind in ("secondary", "twig") and lod_level >= 3:
            return
        steps = {
            "trunk": (len(path), 7, 4, 3, 3),
            "root": (len(path), 4, 0, 0, 0),
            "primary": (len(path), 4, 3, 2, 2),
            "secondary": (len(path), 3, 2, 0, 0),
            "twig": (len(path), 3, 2, 0, 0),
            "leader": (len(path), 4, 3, 2, 2),
        }[kind][lod_level]
        if steps < 2:
            return
        path, radii = reduced_profile(path, radii, steps)
        max_sides = (sides, min(sides, 5), min(sides, 4), min(sides, 4), min(sides, 4))[lod_level]
        shape.tube(path, radii, slot=slot, sides=max(3, max_sides), smooth=smooth)

    add_wood(trunk_path, trunk_radii, slot=0, sides=12, smooth=True, kind="trunk")

    # Curved surface roots flare broadly into the trunk and fork underground.
    for root_index in range(7):
        angle = TAU * root_index / 7 + rng.uniform(-0.22, 0.22)
        direction = Vector((math.cos(angle), math.sin(angle), 0))
        sideways = Vector((-direction.y, direction.x, 0))
        length = rng.uniform(0.78, 1.16)
        root_path = [
            (0.03, 0.00, 0.46),
            tuple(direction * (length * 0.16) + sideways * rng.uniform(-0.035, 0.035) + Vector((0, 0, 0.34))),
            tuple(direction * (length * 0.38) + sideways * rng.uniform(-0.055, 0.055) + Vector((0, 0, 0.20))),
            tuple(direction * (length * 0.70) + sideways * rng.uniform(-0.075, 0.075) + Vector((0, 0, 0.085))),
            tuple(direction * length + sideways * rng.uniform(-0.10, 0.10) + Vector((0, 0, 0.018))),
        ]
        add_wood(root_path, [0.205, 0.170, 0.118, 0.073, 0.030], slot=0,
                 sides=9, smooth=True, kind="root", retain=(lod_level == 0 or (lod_level == 1 and root_index % 2 == 0)))
        if root_index % 2 == 0:
            split_start = _as_vector(root_path[2])
            split_direction = (direction * 0.66 + sideways * (0.55 if root_index % 4 == 0 else -0.55)).normalized()
            split_end = split_start + split_direction * rng.uniform(0.35, 0.56) + Vector((0, 0, -0.13))
            split_path = [tuple(split_start), tuple(split_start.lerp(split_end, 0.42) + sideways * 0.035), tuple(split_end)]
            add_wood(split_path, [0.066, 0.040, 0.018], slot=0, sides=7,
                     smooth=True, kind="root", retain=(lod_level == 0 or lod_level == 1))

    # Seven broad branch tiers leave lower trunk visible beneath the crown.
    whorl_heights = [1.12, 1.92, 2.76, 3.62, 4.50, 5.36, 6.18, 6.83]
    primary_records = []
    for level, height in enumerate(whorl_heights):
        t = height / 7.45
        branch_count = 5 if level not in (1, 5) else 6
        phase = level * 1.17 + 0.29
        trunk_x = 0.04 + 0.086 * max(0, height - 0.75)
        trunk_y = height * 0.008
        trunk_radius = max(0.17 * (1.0 - t) + 0.028, 0.040)
        for branch_index in range(branch_count):
            angle = phase + TAU * branch_index / branch_count + rng.uniform(-0.20, 0.20)
            outward = Vector((math.cos(angle), math.sin(angle), 0))
            # Eastern limbs shorten and every tip drifts with the prevailing wind.
            wind_factor = 0.64 if outward.x > 0.42 else (0.84 if outward.x > 0.05 else 1.0)
            natural_length = 2.32 * (1.0 - t) ** 0.61 + 0.16
            length = natural_length * wind_factor * rng.uniform(0.83, 1.13)
            start = Vector((trunk_x, trunk_y, height)) + outward * trunk_radius * 0.56
            rise = 0.19 + 0.10 * math.sin(angle * 2.0 + level)
            droop = (0.27 + 0.14 * rng.random()) * (0.38 + 0.62 * (1.0 - t))
            lateral = rng.uniform(-0.15, 0.15) * length
            path = _branch_path(start, outward, length, rise, droop, lateral, samples=5)
            base_radius = 0.086 * (1.0 - t * 0.78) * rng.uniform(0.84, 1.13)
            retain_primary = not (lod_level == 4 and len(primary_records) % 7 == 0)
            add_wood(path, [base_radius * f for f in (1.0, 0.80, 0.55, 0.30, 0.095)],
                     slot=0, sides=6, smooth=True, kind="primary", retain=retain_primary)
            primary_records.append((path, outward, length, base_radius, level, angle, branch_index, retain_primary))

    sprig_candidates = 0
    sprig_count = 0
    card_count = 0
    accent_needle_count = 0

    def add_foliage(path, axis, level, stations, phase):
        nonlocal sprig_candidates, sprig_count, card_count, accent_needle_count
        axis = _as_vector(axis).normalized()
        canopy_t = min(1.0, max(0.0, level / 7.0))
        for station_index, station in enumerate(stations):
            anchor = _path_point(path, station)
            local_index = min(len(path) - 2, max(0, int(station * (len(path) - 1))))
            tangent = (_as_vector(path[local_index + 1]) - _as_vector(path[local_index])).normalized()
            side = Vector((-tangent.y, tangent.x, 0.0))
            if side.length < 1e-5:
                side = Vector((1, 0, 0))
            else:
                side.normalize()
            vertical = tangent.cross(side).normalized()
            if vertical.z < 0:
                vertical.negate()
            # Each shoot node carries a broad crossed pair of cutout sprigs.
            # Their local UVs keep the atlas silhouette aligned base-to-tip.
            azimuth = phase + station_index * 2.399963229728653 + rng.uniform(-0.52, 0.52)
            radial = side * math.cos(azimuth) + vertical * math.sin(azimuth)
            sprig_axis = (tangent * rng.uniform(0.44, 0.66) + radial * rng.uniform(0.48, 0.77) + z_axis * rng.uniform(0.02, 0.20)).normalized()
            sprig_length = rng.uniform(0.24, 0.36)
            base = anchor + tangent * rng.uniform(-0.045, 0.045) + radial * rng.uniform(0.012, 0.042)
            tip = base + sprig_axis * sprig_length + radial * (sprig_length * rng.uniform(0.04, 0.16))
            width = rng.uniform(0.15, 0.22) / math.sqrt(foliage_density)
            curve = rng.uniform(0.025, 0.075)
            slot = 1 + min(3, int((1.0 - canopy_t) * 3.2))
            candidate_index = sprig_candidates
            sprig_candidates += 1
            keep_sprig = rng.random() <= foliage_density
            accent_chance = rng.random()

            # Consume accent dimensions on every density level for stable
            # deterministic structural LOD generation.
            accent_direction = (sprig_axis + radial * rng.uniform(-0.45, 0.45) + z_axis * rng.uniform(-0.18, 0.32)).normalized()
            accent_length = rng.uniform(0.12, 0.18)
            accent_radius = rng.uniform(0.0038, 0.0048) / math.sqrt(foliage_density)
            accent_base = base + radial * rng.uniform(-0.035, 0.035)
            accent_tip = accent_base + accent_direction * accent_length

            if keep_sprig:
                card_sections = (3, 3, 3, 3, 2)[lod_level]
                shape.sprig_card(base, tip, width, slot, roll=0.0, curve=curve, sections=card_sections)
                shape.sprig_card(base, tip, width, slot, roll=math.pi * 0.5,
                                 curve=curve * 0.82, sections=card_sections)
                sprig_count += 1
                card_count += 2

            # Opaque tetra needles remain a restrained close-up detail in the
            # fully opaque accent tiles (slots 5–7), outside the alpha cutout.
            if lod_level < 2 and keep_sprig and accent_chance < 0.11:
                accent_slot = 6 if level >= 6 and candidate_index % 3 == 0 else (7 if candidate_index % 29 == 0 else 5)
                shape.tetra_needle(accent_base, accent_tip, accent_radius, accent_slot)
                accent_needle_count += 1

    secondary_records = []
    tertiary_count = 0
    # Five or six staggered forks on each primary create uneven branch tiers.
    for primary_path, outward, primary_length, primary_radius, level, angle, branch_index, _retain_primary in primary_records:
        fork_count = 6 if branch_index % 2 == 0 else 5
        for fork in range(fork_count):
            t = 0.31 + fork * (0.10 if fork_count == 6 else 0.115) + rng.uniform(-0.018, 0.018)
            start = _path_point(primary_path, t)
            sign = -1 if fork % 2 == 0 else 1
            side = Vector((-outward.y, outward.x, 0)) * sign
            direction = (outward * 0.60 + side * 0.73 + z_axis * rng.uniform(-0.04, 0.20)).normalized()
            length = primary_length * (0.27 - 0.04 * t) * rng.uniform(0.89, 1.13)
            shoot_path = _branch_path(start, direction, length, 0.18, 0.15, rng.uniform(-0.035, 0.035), samples=4)
            radius = primary_radius * 0.48
            retain_secondary = lod_level <= 2
            add_wood(shoot_path, [radius, radius * 0.69, radius * 0.39, max(radius * 0.10, 0.0028)],
                     slot=0, sides=4, smooth=True, kind="secondary", retain=retain_secondary)
            secondary_records.append((shoot_path, direction, length, level, angle + sign * 0.45))
            add_foliage(shoot_path, direction, level, (0.13, 0.30, 0.47, 0.64, 0.81, 0.96), angle + fork * 0.31)

            # Two smaller lateral twigs extend each secondary into a forked spray.
            for spur in range(2):
                spur_t = 0.39 + spur * 0.34 + rng.uniform(-0.03, 0.03)
                spur_start = _path_point(shoot_path, spur_t)
                spur_sign = -1 if spur == 0 else 1
                spur_side = Vector((-direction.y, direction.x, 0)) * spur_sign
                spur_direction = (direction * 0.59 + spur_side * 0.76 + z_axis * rng.uniform(-0.04, 0.18)).normalized()
                spur_length = length * rng.uniform(0.40, 0.54)
                spur_path = _branch_path(spur_start, spur_direction, spur_length, 0.16, 0.12, rng.uniform(-0.02, 0.02), samples=3)
                spur_radius = max(radius * 0.43, 0.006)
                add_wood(spur_path, [spur_radius, spur_radius * 0.58, 0.0025],
                         slot=0, sides=4, smooth=True, kind="twig",
                         retain=(lod_level < 2 or (lod_level == 2 and spur == 0)))
                add_foliage(spur_path, spur_direction, level, (0.15, 0.39, 0.64, 0.89), angle + spur * 0.57 + fork * 0.19)
                tertiary_count += 1

    # A curved, living leader reaches the crown tip; no bare pole remains.
    leader_path = [
        (0.58, 0.05, 6.45), (0.63, 0.035, 6.78), (0.73, 0.00, 7.13), (0.88, -0.06, 7.48),
    ]
    add_wood(leader_path, [0.052, 0.035, 0.017, 0.003],
             slot=0, sides=7, smooth=True, kind="leader")
    add_foliage(leader_path, Vector((0.36, -0.22, 0.90)), 7, (0.10, 0.19, 0.28, 0.37, 0.46, 0.55, 0.64, 0.73, 0.82, 0.91, 0.98), 0.2)

    # Only a few shaded cones sit under the dense crown.
    if lod_level < 2:
        for cone_index in range(8):
            primary_path, outward, branch_length, _, level, _, _, _ = primary_records[(cone_index * 9 + 4) % len(primary_records)]
            if level < 2:
                continue
            base = _path_point(primary_path, rng.uniform(0.62, 0.86)) + Vector((0, 0, -0.04))
            tip = base + Vector((outward.x * 0.035, outward.y * 0.035, -rng.uniform(0.10, 0.15)))
            shape.cone(base, tip, rng.uniform(0.026, 0.037), slot=5, sides=6, rings=4, smooth=True)

    return shape, {
        "sprig_count": sprig_count,
        "sprig_candidates": sprig_candidates,
        "card_count": card_count,
        "accent_needle_count": accent_needle_count,
        "foliage_density": foliage_density,
        "lod_level": lod_level,
        "primary_branches": len(primary_records),
        "secondary_shoots": len(secondary_records),
        "tertiary_shoots": tertiary_count,
        "leader_tip_z": 7.48,
    }


def _fractured_column(shape, center, radius, height, sides, seed, palette_shift=0):
    """Build a continuous column with fine joints and a chipped, tilted crown."""
    rng = random.Random(seed)
    cx, cy, base_z = center
    crack_a = rng.uniform(0.010, 0.020)
    crack_b = rng.uniform(0.012, 0.022)
    levels = [
        0.0, 0.075, 0.17, 0.30, 0.30 + crack_a / height,
        0.43, 0.56, 0.66, 0.66 + crack_b / height,
        0.79, 0.90, 0.955, 0.982, 1.0,
    ]
    ring_count = len(levels)
    vertices = []
    ring_offsets = []
    phase = rng.uniform(-0.16, 0.16)
    lean_x = rng.uniform(-0.12, 0.12)
    lean_y = rng.uniform(-0.10, 0.10)
    seam_levels = {3, 7}
    chipped_sides = set(rng.sample(range(sides), max(1, sides // 4)))
    side_z_offsets = [rng.uniform(-0.014, 0.014) * radius for _ in range(sides)]
    for ring, t in enumerate(levels):
        if ring in (3, 4, 7, 8):
            seam_scale = 0.972
        else:
            seam_scale = 1.0
        radius_scale = (1.0 - 0.10 * t) * seam_scale
        ring_offset = len(vertices)
        ring_offsets.append(ring_offset)
        for side in range(sides):
            angle = phase + TAU * side / sides + rng.uniform(-0.045, 0.045)
            facet = 1.0 + 0.072 * math.sin(side * 2.13 + seed) + rng.uniform(-0.035, 0.035)
            if ring == ring_count - 1 and side in chipped_sides:
                facet *= rng.uniform(0.80, 0.92)
            r = radius * radius_scale * facet
            segment_tilt = max(0.0, (t - 0.66) / 0.34)
            x = cx + lean_x * t + 0.09 * segment_tilt + r * math.cos(angle)
            y = cy + lean_y * t - 0.055 * segment_tilt + r * math.sin(angle)
            z_jitter = side_z_offsets[side] if ring else 0.0
            if ring == ring_count - 1:
                z_jitter += rng.uniform(-0.17, 0.17) * radius
            elif ring >= ring_count - 3:
                z_jitter += rng.uniform(-0.045, 0.045) * radius
            z = base_z + height * t + z_jitter
            vertices.append((x, y, z))

    faces = []
    slots = []
    for ring in range(ring_count - 1):
        seam = ring in seam_levels
        for side in range(sides):
            a = ring_offsets[ring] + side
            b = ring_offsets[ring] + (side + 1) % sides
            c = ring_offsets[ring + 1] + (side + 1) % sides
            d = ring_offsets[ring + 1] + side
            pa, pb, pc, pd = (Vector(vertices[index]) for index in (a, b, c, d))
            face_center = (pa + pb + pc + pd) * 0.25
            radial = Vector((face_center.x - cx, face_center.y - cy, 0.0))
            radial.normalize()
            # A tiny offset makes broad column faces break into shallow facets.
            displacement = radius * rng.uniform(-0.034, 0.034)
            face_center += radial * displacement
            face_center.z += rng.uniform(-0.010, 0.010) * radius
            middle = len(vertices)
            vertices.append(tuple(face_center))
            faces.extend(((a, b, middle), (b, c, middle), (c, d, middle), (d, a, middle)))
            if seam:
                face_slot = 0
            else:
                face_slot = rng.choice((1, 2, 2, 3, 3, 4))
                if rng.random() < 0.018:
                    face_slot = 6
            slots.extend((face_slot,) * 4)

    # The bottom is a simple closed bed.  The top instead has a fractured
    # annulus and a second, independently jagged inner plane so the tallest
    # column ends in chipped cut faces rather than a broad flat polygon.
    faces.append(tuple(reversed(tuple(ring_offsets[0] + side for side in range(sides)))))
    slots.append(1)
    top_ring = ring_offsets[-1]
    inner_ring = len(vertices)
    top_mean = sum(vertices[top_ring + side][2] for side in range(sides)) / sides
    top_center_x = cx + lean_x
    top_center_y = cy + lean_y
    for side in range(sides):
        angle = phase + TAU * side / sides
        radius_here = radius * rng.uniform(0.38, 0.53) * (1.0 + rng.uniform(-0.10, 0.10))
        x = top_center_x + radius_here * math.cos(angle)
        y = top_center_y + radius_here * math.sin(angle)
        z = top_mean + rng.uniform(-0.27, 0.27) * radius
        vertices.append((x, y, z))
    for side in range(sides):
        nxt = (side + 1) % sides
        outer_a, outer_b = top_ring + side, top_ring + nxt
        inner_a, inner_b = inner_ring + side, inner_ring + nxt
        faces.extend(((outer_a, outer_b, inner_b), (outer_a, inner_b, inner_a)))
        slots.extend((4, 3 if side % 4 == 0 else 4))
    fracture_center = len(vertices)
    vertices.append((top_center_x + rng.uniform(-0.10, 0.10) * radius,
                     top_center_y + rng.uniform(-0.10, 0.10) * radius,
                     top_mean + rng.uniform(-0.24, 0.22) * radius))
    for side in range(sides):
        faces.append((inner_ring + side, inner_ring + (side + 1) % sides, fracture_center))
        slots.append(4 if side % 3 else 3)

    shape.add_component(vertices, faces, slots, smooth=False)


def _fractured_chip(shape, center, radius, height, sides, seed):
    """Closed talus chip with uneven crown edges and charcoal-toned facets."""
    rng = random.Random(seed)
    cx, cy, z = center
    phase = rng.uniform(0, TAU)
    levels = [0.0, 0.18, 0.62, 0.86, 1.0]
    vertices = []
    ring_offsets = []
    for ring, t in enumerate(levels):
        ring_offsets.append(len(vertices))
        for side in range(sides):
            angle = phase + TAU * side / sides + rng.uniform(-0.10, 0.10)
            pinch = 1.0 + rng.uniform(-0.17, 0.17) + 0.10 * math.sin(side * 2.7 + seed)
            if ring == len(levels) - 1 and side % 3 == 0:
                pinch *= rng.uniform(0.76, 0.92)
            radius_here = radius * pinch * (0.92 if ring == 1 else 1.0)
            x = cx + radius_here * math.cos(angle) + t * rng.uniform(-0.06, 0.06) * radius
            y = cy + radius_here * math.sin(angle) + t * rng.uniform(-0.06, 0.06) * radius
            jitter = rng.uniform(-0.18, 0.18) * height if ring == len(levels) - 1 else (rng.uniform(-0.05, 0.05) * height if ring else 0.0)
            zz = z + height * t + jitter
            vertices.append((x, y, zz))
    faces = []
    slots = []
    for ring in range(len(levels) - 1):
        for side in range(sides):
            a = ring_offsets[ring] + side
            b = ring_offsets[ring] + (side + 1) % sides
            c = ring_offsets[ring + 1] + (side + 1) % sides
            d = ring_offsets[ring + 1] + side
            pa, pb, pc, pd = (Vector(vertices[index]) for index in (a, b, c, d))
            face_center = (pa + pb + pc + pd) * 0.25
            face_center += Vector((rng.uniform(-0.035, 0.035), rng.uniform(-0.035, 0.035), rng.uniform(-0.018, 0.018))) * radius
            middle = len(vertices)
            vertices.append(tuple(face_center))
            faces.extend(((a, b, middle), (b, c, middle), (c, d, middle), (d, a, middle)))
            slot = rng.choice((1, 2, 2, 3, 3, 4))
            slots.extend((slot,) * 4)
    faces.append(tuple(reversed(tuple(ring_offsets[0] + side for side in range(sides)))))
    slots.append(1)
    faces.append(tuple(ring_offsets[-1] + side for side in range(sides)))
    slots.append(4)
    shape.add_component(vertices, faces, slots, smooth=False)


def build_basalt_spires(seed=943):
    """Cluster of weathered polygonal basalt columns and sharp talus."""
    shape = Shape()
    rng = random.Random(seed)
    columns = [
        ((0.02, 0.10, 0.02), 0.62, 3.34, 9),
        ((-0.59, -0.05, 0.02), 0.48, 2.48, 8),
        ((0.67, -0.04, 0.02), 0.45, 2.10, 7),
        ((-0.23, 0.63, 0.02), 0.43, 2.72, 8),
        ((0.46, 0.69, 0.02), 0.39, 1.82, 7),
        ((-0.80, 0.59, 0.02), 0.35, 1.74, 7),
        ((0.96, 0.42, 0.02), 0.34, 1.48, 7),
        ((-0.52, -0.67, 0.02), 0.39, 1.94, 8),
        ((0.38, -0.73, 0.02), 0.37, 1.66, 7),
    ]
    for index, (center, radius, height, sides) in enumerate(columns):
        height *= rng.uniform(0.93, 1.08)
        _fractured_column(shape, center, radius, height, sides, seed + index * 17, index % 3)

    # Talus sits around the column feet, with a few pieces breaking the outer
    # silhouette. Every chip is an independently closed faceted solid.
    chip_count = 54
    for index in range(chip_count):
        angle = rng.uniform(0, TAU)
        radial = rng.uniform(0.87, 1.82)
        x = math.cos(angle) * radial + rng.uniform(-0.18, 0.18)
        y = math.sin(angle) * radial + rng.uniform(-0.18, 0.18)
        radius = rng.uniform(0.105, 0.235)
        height = rng.uniform(0.20, 0.57)
        sides = rng.randint(6, 9)
        _fractured_chip(shape, (x, y, 0.018), radius, height, sides, seed + 200 + index * 11)

    return shape, {"columns": len(columns), "talus_chips": chip_count}


PINE_PALETTE = ["#62472f", "#153c32", "#235a41", "#397450", "#5a8b5b", "#856b42", "#94a267", "#263f39"]
BASALT_PALETTE = ["#24282d", "#34383d", "#383d42", "#3d4246", "#42474b", "#353a40", "#444a4e", "#4b5053"]
_SHARED_ATLAS_ROOT = Path("/tmp/orbit-foundry-stock-atlases")
_SHARED_IMAGE_CACHE = {}
_PREVIEW_MATERIAL_CACHE = {}


def _hex_color(value):
    value = value.lstrip("#")
    srgb = tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    linear = tuple(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in srgb)
    return linear + (1.0,)


def _scale_color(color, factor):
    return tuple(min(1.0, max(0.0, channel * factor)) for channel in color[:3]) + (1.0,)


def _load_shared_image(asset_id, role, colorspace):
    path = _SHARED_ATLAS_ROOT / f"{asset_id}_{role}.png"
    if not path.exists():
        return None
    key = str(path)
    image = _SHARED_IMAGE_CACHE.get(key)
    if image is None:
        image = bpy.data.images.load(key, check_existing=False)
        _SHARED_IMAGE_CACHE[key] = image
    try:
        image.colorspace_settings.name = colorspace
    except TypeError:
        pass
    if image.packed_file is None:
        try:
            image.pack()
        except RuntimeError:
            pass
    return image


def _flipped_atlas_uv(nodes, links):
    """Create the shared atlas convention's UV sample (u, 1-v, 0)."""
    coordinates = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coordinates.outputs["UV"], separate.inputs["Vector"])
    one_minus_v = nodes.new("ShaderNodeMath")
    one_minus_v.operation = "SUBTRACT"
    one_minus_v.inputs[0].default_value = 1.0
    links.new(separate.outputs["Y"], one_minus_v.inputs[1])
    combine = nodes.new("ShaderNodeCombineXYZ")
    links.new(separate.outputs["X"], combine.inputs["X"])
    links.new(one_minus_v.outputs[0], combine.inputs["Y"])
    return combine.outputs["Vector"]


def _image_texture(nodes, links, image, vector, label):
    texture = nodes.new("ShaderNodeTexImage")
    texture.label = label
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "CLIP"
    links.new(vector, texture.inputs["Vector"])
    return texture


def make_preview_material(name, hex_color, kind, slot, asset_id=None):
    """Build a preview shader from shared atlas maps, with procedural fallback."""
    cache_key = (asset_id, int(slot), str(hex_color), str(kind))
    cached = _PREVIEW_MATERIAL_CACHE.get(cache_key)
    if cached is not None:
        return cached
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = _hex_color(hex_color)
    nodes = material.node_tree.nodes
    nodes.clear()
    links = material.node_tree.links
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = _hex_color(hex_color)
    shader.inputs["Roughness"].default_value = 0.88 if kind == "rock" else 0.82
    if "IOR" in shader.inputs:
        shader.inputs["IOR"].default_value = 1.42
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    coordinates = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    if kind == "bark":
        coordinates_output = coordinates.outputs["UV"]
        mapping.inputs["Scale"].default_value = (72.0, 3.0, 1.0)
        noise_scale, bump_strength, bump_distance = 2.4, 0.24, 0.055
    elif kind == "needle":
        coordinates_output = coordinates.outputs["UV"]
        mapping.inputs["Scale"].default_value = (4.0, 38.0, 1.0)
        noise_scale, bump_strength, bump_distance = 2.0, 0.08, 0.012
    elif kind == "rock":
        coordinates_output = coordinates.outputs["UV"]
        mapping.inputs["Scale"].default_value = (17.0, 17.0, 1.0)
        noise_scale, bump_strength, bump_distance = 3.0, 0.21, 0.032
    else:
        coordinates_output = coordinates.outputs["Generated"]
        mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
        noise_scale, bump_strength, bump_distance = 5.0, 0.1, 0.02
    links.new(coordinates_output, mapping.inputs["Vector"])

    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = noise_scale
    noise.inputs["Detail"].default_value = 3.0 if kind == "rock" else 2.0
    noise.inputs["Roughness"].default_value = 0.72
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    base = _hex_color(hex_color)
    ramp.color_ramp.elements[0].position = 0.16
    ramp.color_ramp.elements[0].color = _scale_color(base, 0.70 if kind == "rock" else 0.82)
    ramp.color_ramp.elements[1].position = 0.84
    ramp.color_ramp.elements[1].color = _scale_color(base, 1.18 if kind != "needle" else 1.12)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])

    diffuse_image = _load_shared_image(asset_id, "diffuse", "sRGB") if asset_id else None
    normal_image = _load_shared_image(asset_id, "normal", "Non-Color") if asset_id else None
    orm_image = _load_shared_image(asset_id, "orm", "Non-Color") if asset_id else None
    opacity_image = _load_shared_image(asset_id, "opacity", "Non-Color") if asset_id and kind == "cutout" else None
    atlas_ready = bool(diffuse_image and normal_image and orm_image)

    if atlas_ready:
        uv = _flipped_atlas_uv(nodes, links)
        diffuse_texture = _image_texture(nodes, links, diffuse_image, uv, f"{asset_id} · shared diffuse atlas")
        orm_texture = _image_texture(nodes, links, orm_image, uv, f"{asset_id} · shared ORM atlas")
        normal_texture = _image_texture(nodes, links, normal_image, uv, f"{asset_id} · shared normal atlas")
        for input_name in ("Base Color", "Roughness", "Metallic", "Normal"):
            for link in list(shader.inputs[input_name].links):
                links.remove(link)
        links.new(diffuse_texture.outputs["Color"], shader.inputs["Base Color"])
        orm_channels = nodes.new("ShaderNodeSeparateColor")
        orm_channels.mode = "RGB"
        links.new(orm_texture.outputs["Color"], orm_channels.inputs["Color"])
        links.new(orm_channels.outputs["Green"], shader.inputs["Roughness"])
        links.new(orm_channels.outputs["Blue"], shader.inputs["Metallic"])
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = 1.0
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])

        if opacity_image:
            opacity_texture = _image_texture(nodes, links, opacity_image, uv, f"{asset_id} · shared opacity atlas")
            cutoff = nodes.new("ShaderNodeMath")
            cutoff.operation = "GREATER_THAN"
            cutoff.inputs[1].default_value = 0.4
            grayscale = nodes.new("ShaderNodeRGBToBW")
            links.new(opacity_texture.outputs["Color"], grayscale.inputs["Color"])
            links.new(grayscale.outputs["Val"], cutoff.inputs[0])
            links.new(cutoff.outputs[0], shader.inputs["Alpha"])
            if hasattr(material, "surface_render_method"):
                try:
                    material.surface_render_method = "DITHERED"
                except TypeError:
                    pass
            if hasattr(material, "alpha_threshold"):
                try:
                    material.alpha_threshold = 0.4
                except (AttributeError, TypeError):
                    pass
            if hasattr(material, "use_backface_culling"):
                material.use_backface_culling = False

    relief = noise
    if kind == "rock":
        fracture = nodes.new("ShaderNodeTexVoronoi")
        fracture.inputs["Scale"].default_value = 28.0
        links.new(mapping.outputs["Vector"], fracture.inputs["Vector"])
        relief = fracture
    if not atlas_ready:
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = bump_strength
        bump.inputs["Distance"].default_value = bump_distance
        links.new(relief.outputs["Fac"] if "Fac" in relief.outputs else relief.outputs["Distance"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    _PREVIEW_MATERIAL_CACHE[cache_key] = material
    return material


def create_stock_object(scene, collection, asset_id, name, shape, palette, category, metadata=None):
    mesh = bpy.data.meshes.new(asset_id)
    mesh.from_pydata(shape.vertices, [], shape.faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    metadata = dict(metadata or {})
    cutout_asset = bool(metadata.get("cutout", asset_id in ("wind_pine", "umbrella_tree")))
    for slot, color in enumerate(palette):
        if category == "rock":
            kind = "rock"
        elif slot == 0:
            kind = "bark"
        elif cutout_asset and 1 <= slot <= 4:
            kind = "cutout"
        else:
            kind = "needle"
        mesh.materials.append(make_preview_material(f"{asset_id} · slot {slot}", color, kind, slot, asset_id=asset_id))
    for polygon, slot, smooth in zip(mesh.polygons, shape.material_indices, shape.smooth):
        polygon.material_index = slot
        polygon.use_smooth = smooth
    mesh.validate(verbose=False)
    if len(mesh.polygons) != len(shape.faces):
        raise RuntimeError(f"{asset_id}: Blender removed {len(shape.faces) - len(mesh.polygons)} invalid faces before UV assignment")
    mesh.update()

    uv_layer = mesh.uv_layers.new(name="Atlas UV")
    loop_index = 0
    for face_uv in shape.face_uvs:
        for uv in face_uv:
            uv_layer.data[loop_index].uv = uv
            loop_index += 1
    if loop_index != len(mesh.loops):
        raise RuntimeError(f"{asset_id}: UV loop count {loop_index} != mesh loop count {len(mesh.loops)}")

    # All closed sweeps are authored outward; open cutout cards intentionally
    # keep their authored front winding and rely on double-sided materials.
    mesh.update()
    mesh.calc_loop_triangles()

    for vertex in mesh.vertices:
        if vertex.co.z < 0.0 and vertex.co.z > -0.03:
            vertex.co.z = 0.0
    mesh.update()
    obj["stock_id"] = asset_id
    obj["category"] = category
    obj["lod_role"] = "LOD0 source"
    obj["cutout"] = cutout_asset
    for key, value in metadata.items():
        if isinstance(value, (str, int, float, bool)):
            obj[key] = value
    return obj


def _configure_studio(scene, collection):
    ground_mesh = bpy.data.meshes.new("Field specimens · studio floor mesh")
    # Extend beyond the full 5x5 gallery camera frustum so the neutral studio
    # floor has no visible edge or dark-world band in the contact sheet.
    ground_mesh.from_pydata([(-36, -36, -0.025), (36, -36, -0.025), (36, 36, -0.025), (-36, 36, -0.025)], [], [(0, 1, 2, 3)])
    ground_mesh.update()
    ground = bpy.data.objects.new("Neutral studio floor", ground_mesh)
    collection.objects.link(ground)
    floor = bpy.data.materials.new("Neutral warm-gray studio")
    floor.use_nodes = True
    floor.diffuse_color = (0.30, 0.32, 0.32, 1.0)
    floor_shader = next(node for node in floor.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    floor_shader.inputs["Base Color"].default_value = (0.30, 0.32, 0.32, 1.0)
    floor_shader.inputs["Roughness"].default_value = 0.93
    ground_mesh.materials.append(floor)

    light_type = next(item.identifier for item in bpy.types.Light.bl_rna.properties["type"].enum_items if item.identifier.upper() == "AREA")
    area_shape = next(item.identifier for item in bpy.types.AreaLight.bl_rna.properties["shape"].enum_items if item.identifier.upper() == "DISK")
    for light_name, location, energy, size in [
        ("Large soft key", (0.0, -8.0, 12.0), 1700.0, 8.0),
        ("Broad fill", (-8.0, -1.0, 7.0), 1150.0, 9.0),
        ("Cool rim", (3.0, 6.0, 10.0), 1800.0, 7.0),
    ]:
        data = bpy.data.lights.new(light_name, type=light_type)
        data.energy = energy
        data.shape = area_shape
        data.size = size
        obj = bpy.data.objects.new(light_name, data)
        collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0.0, 0.0, 2.6)) - obj.location).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("Field specimen camera")
    camera = bpy.data.objects.new("Field specimen camera", camera_data)
    collection.objects.link(camera)
    camera.location = (11.5, -18.0, 11.7)
    camera.rotation_euler = (Vector((0.0, 0.0, 3.35)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = next(item.identifier for item in bpy.types.Camera.bl_rna.properties["type"].enum_items if item.identifier.upper() == "ORTHO")
    camera.data.ortho_scale = 13.6
    scene.camera = camera
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.resolution_percentage = 100
    engine_items = [item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    eevee = next((value for value in engine_items if "EEVEE" in value.upper()), None)
    if eevee:
        try:
            scene.render.engine = eevee
        except TypeError:
            pass
    scene.render.image_settings.file_format = next(item.identifier for item in bpy.types.ImageFormatSettings.bl_rna.properties["file_format"].enum_items if item.identifier.upper() == "PNG")
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("Field specimen world")
    scene.world.use_nodes = True
    background = next(node for node in scene.world.node_tree.nodes if node.type == "BACKGROUND")
    background.inputs["Color"].default_value = (0.31, 0.34, 0.36, 1.0)
    background.inputs["Strength"].default_value = 0.34
    return ground


def build_prototype_scene(scene_name="Orbit Foundry · Field Specimens"):
    """Build only the two review prototypes in a new, isolated Blender scene."""
    existing = bpy.data.scenes.get(scene_name)
    if existing is None:
        scene = bpy.data.scenes.new(scene_name)
    else:
        scene = existing
        for obj in list(scene.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
    if bpy.context.window is not None:
        bpy.context.window.scene = scene
    collection = bpy.data.collections.new("Field specimens · prototypes")
    scene.collection.children.link(collection)
    ground = _configure_studio(scene, collection)

    basalt_shape, basalt_details = build_basalt_spires()
    pine_shape, pine_details = build_wind_pine()
    basalt = create_stock_object(scene, collection, "basalt_spires", "Basalt spires · prototype", basalt_shape, BASALT_PALETTE, "rock")
    pine = create_stock_object(scene, collection, "wind_pine", "Wind pine · prototype", pine_shape, PINE_PALETTE, "tree")
    basalt.location.x = -2.0
    pine.location.x = 2.2

    # Keep a clean, useful viewport when the prototype scene is first selected.
    for selected in list(bpy.context.selected_objects):
        selected.select_set(False)
    pine.select_set(True)
    bpy.context.view_layer.objects.active = pine
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_distance = 16.5
                area.spaces.active.region_3d.view_location = Vector((0.0, 0.0, 3.5))
                area.spaces.active.region_3d.view_rotation = scene.camera.rotation_euler.to_quaternion()
    return {
        "scene": scene.name,
        "objects": [basalt.name, pine.name],
        "triangle_counts": {"basalt_spires": len(basalt.data.loop_triangles), "wind_pine": len(pine.data.loop_triangles)},
        "basalt": basalt_details,
        "pine": pine_details,
        "ground": ground.name,
    }

