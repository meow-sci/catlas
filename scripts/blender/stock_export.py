"""Indexed, quantized native stock meshes with authored UVs and five LODs.

Run inside Blender. The registry is an original source asset, independent of
the editable gallery's object transforms and camera setup.
"""
import base64
import json
import math
import struct
from pathlib import Path

import bpy

LOD_RATIOS = (1.0, .66, .40, .23, .12)
FOLIAGE_LOD_RATIOS = (1.0, .82, .65, .50, .36)


def atlas_uv(slot, local):
    return ((slot % 4 + .02 + .96 * local[0]) / 4,
            (slot // 4 + .02 + .96 * local[1]) / 2)


def _decoded_uv_area(uvs):
    """Check the exact Float32 UVs returned by the browser's packed decoder."""
    a, b, c = [tuple(struct.unpack('<f', struct.pack('<f', round(v*65535)/65535))[0]
                     for v in uv) for uv in uvs]
    return abs((b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1]))


def _component_bounds(mesh):
    parents = list(range(len(mesh.vertices)))
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    for edge in mesh.edges:
        a, b = edge.vertices
        parents[find(b)] = find(a)
    roots = [find(i) for i in range(len(parents))]
    bounds = {}
    for vertex, root in zip(mesh.vertices, roots):
        if root not in bounds:
            bounds[root] = [[float(v), float(v)] for v in vertex.co]
        for axis, v in enumerate(vertex.co):
            bounds[root][axis][0] = min(bounds[root][axis][0], v)
            bounds[root][axis][1] = max(bounds[root][axis][1], v)
    return roots, bounds


def _outward(triangles):
    """Orient disconnected solids after decimation, without assuming one centre."""
    parents = {}
    def find(p):
        parents.setdefault(p, p)
        if parents[p] != p:
            parents[p] = find(parents[p])
        return parents[p]
    for tri in triangles:
        points = [v[0] for v in tri]
        root = find(points[0])
        for p in points[1:]:
            parents[find(p)] = root
    volumes, edges = {}, {}
    for tri in triangles:
        a, b, c = [v[0] for v in tri]
        root = find(a)
        counts = edges.setdefault(root, {})
        for p, q in ((a, b), (b, c), (c, a)):
            edge = tuple(sorted((p, q)))
            counts[edge] = counts.get(edge, 0) + 1
        volume = (a[0] * (b[1]*c[2]-b[2]*c[1])
                  + a[1] * (b[2]*c[0]-b[0]*c[2])
                  + a[2] * (b[0]*c[1]-b[1]*c[0]))
        volumes[root] = volumes.get(root, 0) + volume
    closed = {root for root, counts in edges.items() if all(count == 2 for count in counts.values())}
    for tri in triangles:
        root = find(tri[0][0])
        if root in closed and volumes[root] < -1e-12:
            tri[1], tri[2] = tri[2], tri[1]
            for v in tri:
                v[1] = tuple(-n for n in v[1])


def _pack(triangles):
    points = [v[0] for tri in triangles for v in tri]
    minimum = tuple(min(p[axis] for p in points) for axis in range(3))
    maximum = tuple(max(p[axis] for p in points) for axis in range(3))
    span = tuple(maximum[i] - minimum[i] for i in range(3))
    quantized_triangles = []
    for tri in triangles:
        quantized = []
        for point, normal, uv in tri:
            position = tuple(round((point[i]-minimum[i])/span[i]*65535) if span[i] else 0 for i in range(3))
            length = math.sqrt(sum(n*n for n in normal)) or 1
            normal = tuple(round(max(-1, min(1, n/length))*32767) for n in normal)
            texcoord = tuple(round(max(0, min(1, v))*65535) for v in uv)
            quantized.append([position, normal, texcoord])
        a, b, c = [q[0] for q in quantized]
        ab, ac = [b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)]
        if not any((ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0])):
            continue
        if _decoded_uv_area([v[2] for v in tri]) <= 1e-10:
            raise ValueError('UV area collapsed after quantization; repair source mapping')
        quantized_triangles.append(quantized)
    # Quantization can change tiny component closure or orientation. Check the
    # representation that actually ships, not only the unquantized source.
    _outward(quantized_triangles)
    normal_repairs = 0
    records, indices, lookup = [], [], {}
    for quantized in quantized_triangles:
        points = [tuple(struct.unpack('<f', struct.pack('<f', minimum[i]+v[0][i]/65535*span[i]))[0]
                        for i in range(3)) for v in quantized]
        a, b, c = points
        ab, ac = [b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)]
        face = (ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0])
        length = math.sqrt(sum(v*v for v in face))
        if length < 1e-14:
            continue
        face = tuple(v/length for v in face)
        alignment = sum(sum(face[i]*v[1][i]/32767 for i in range(3)) for v in quantized)/3
        if alignment <= 1e-5:
            # Decimation may inherit opposing normals when a thin closed
            # leaflet becomes an open shard. Preserve its winding and give
            # that triangle the correct geometric normal instead.
            normal = tuple(round(v*32767) for v in face)
            for vertex in quantized:
                vertex[1] = normal
            normal_repairs += 1
        for position, normal, uv in quantized:
            record = struct.pack('<3H3h2H', *position, *normal, *uv)
            if record not in lookup:
                lookup[record] = len(records)
                records.append(record)
            indices.append(lookup[record])
    if normal_repairs:
        print('quantized normal repairs', normal_repairs)
    bits = 16 if len(records) <= 65535 else 32
    index_format = '<' + ('H' if bits == 16 else 'I') * len(indices)
    data = b''.join(records) + struct.pack(index_format, *indices)
    return dict(vertexCount=len(records), indexCount=len(indices), indexBits=bits,
                min=minimum, max=maximum, data=base64.b64encode(data).decode('ascii'))


def mesh_lod(obj, level, ratio):
    modifier = None
    if level and ratio < 1:
        enums = bpy.types.ObjectModifiers.bl_rna.functions['new'].parameters['type'].enum_items
        kind = next(i.identifier for i in enums if i.identifier.upper() == 'DECIMATE')
        modifier = obj.modifiers.new(name=f'Native LOD {level}', type=kind)
        modifier.ratio = ratio
        # Leave boundaries of semantic material regions intact where possible.
        delimiters = bpy.types.DecimateModifier.bl_rna.properties['delimit'].enum_items
        modifier.delimit = {i.identifier for i in delimiters if i.identifier.upper() in ('UV', 'MATERIAL')}
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        # Source winding is authoritative for open, double-sided foliage.
        # Recalculating every BMesh face can flip a card according to origin.
        mesh.update()
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers.active
        if uv is None:
            raise ValueError(f'{obj.name} requires authored UVs')
        triangles = []
        repairs = 0
        # A persistent mesh-space projection provides an emergency map for
        # UVs collapsed by decimation; it keeps grain continuous over surfaces.
        component_roots, all_bounds = _component_bounds(mesh)
        for tri in mesh.loop_triangles:
            if tri.area < 1e-12:
                continue
            slot = mesh.polygons[tri.polygon_index].material_index
            corners = []
            texcoords = [tuple(uv.data[i].uv) for i in tri.loops]
            tiles = {int(tex[0]*4) + 4*int(tex[1]*2) for tex in texcoords}
            lower, upper = atlas_uv(slot, (0, 0)), atlas_uv(slot, (1, 1))
            inside = all(lower[i]-1e-7 <= tex[i] <= upper[i]+1e-7 for tex in texcoords for i in range(2))
            if _decoded_uv_area(texcoords) <= 1e-10 or tiles != {slot} or not inside:
                axes = sorted(range(3), key=lambda axis: abs(tri.normal[axis]))[:2]
                bounds = all_bounds[component_roots[tri.vertices[0]]]
                texcoords = []
                for loop in tri.loops:
                    co = mesh.vertices[mesh.loops[loop].vertex_index].co
                    local = tuple((co[axis]-bounds[axis][0]) / max(1e-9, bounds[axis][1]-bounds[axis][0]) for axis in axes)
                    texcoords.append(atlas_uv(slot, local))
                repairs += 1
            for loop, tex in zip(tri.loops, texcoords):
                co = mesh.vertices[mesh.loops[loop].vertex_index].co
                normal = mesh.corner_normals[loop].vector
                if normal.length < .5:
                    normal = tri.normal
                # Right-handed Blender Z-up to browser/native Y-up.
                corners.append([(co.x, co.z, -co.y), (normal.x, normal.z, -normal.y), tex])
            triangles.append(corners)
        _outward(triangles)
        packed = _pack(triangles)
        print(obj.get('stock_id', obj.name), 'LOD', level, 'triangles', packed['indexCount']//3,
              'indexed vertices', packed['vertexCount'], 'UV repairs', repairs)
        return packed
    finally:
        evaluated.to_mesh_clear()
        if modifier:
            obj.modifiers.remove(modifier)


def export_registry(objects, definitions, destination, lod_sources=None):
    records = []
    for obj, definition in zip(objects, definitions):
        asset_id, name, description, category, _build, palette = definition[:6]
        metadata = dict(definition[6]) if len(definition) > 6 else {}
        bounds = [(min(v.co[i] for v in obj.data.vertices), max(v.co[i] for v in obj.data.vertices)) for i in (0, 2, 1)]
        structural = (lod_sources or {}).get(asset_id)
        if structural is not None and len(structural) != 5:
            raise ValueError(f'{asset_id} requires five structural LOD sources')
        lods = ([mesh_lod(source, level, 1) for level, source in enumerate(structural)]
                if structural else [mesh_lod(obj, level, ratio) for level, ratio in enumerate(
                    FOLIAGE_LOD_RATIOS if category == 'tree' else LOD_RATIOS)])
        record = dict(id=asset_id, name=name, description=description, category=category,
                      dimensionsM=[round(b-a, 6) for a, b in bounds], palette=palette,
                      cutout=asset_id in ('wind_pine', 'umbrella_tree'), lods=lods)
        record.update(metadata)
        records.append(record)
    destination = Path(destination)
    destination.write_text(json.dumps(records, separators=(',', ':')))
    print('REGISTRY', destination, destination.stat().st_size, 'bytes')
    return records
