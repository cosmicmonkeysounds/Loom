## The lobby panel's geometry (`docs/loom-reinstall.md` §5), pure so the
## tests pin it: how many tile columns / rows / pages a list of programs
## gets, where each tile sits on the panel, which button a point on the
## panel is over, and where a pointer's ray meets the panel.
##
## Panel coordinates are metres in the panel's own plane: x right, y up
## (the panel's height above the lobby floor), the panel facing +z.
class_name LobbyTiles
extends RefCounted

## Tiles on a page at most (4 × 2).
const PER_PAGE := 8
const MAX_COLS := 4
## One tile: the picture, its name and tag under it.
const TILE_W := 0.46
const TILE_H := 0.56
const GAP := 0.08
## The grid's centre height on the panel.
const GRID_Y := 1.36


## `{cols, rows, per_page, pages}` for `n` programs: one row up to 4, two
## rows up to 8 (3 + 3, 4 + 3, …), then pages of 4 × 2.
static func layout(n: int) -> Dictionary:
	if n <= 0:
		return {"cols": 0, "rows": 0, "per_page": PER_PAGE, "pages": 0}
	var cols: int
	var rows: int
	if n <= MAX_COLS:
		cols = n
		rows = 1
	elif n <= PER_PAGE:
		cols = ceili(n / 2.0)
		rows = 2
	else:
		cols = MAX_COLS
		rows = 2
	var per_page := cols * rows
	return {"cols": cols, "rows": rows, "per_page": per_page, "pages": ceili(float(n) / float(per_page))}


## The page item `index` is on.
static func page_of(index: int, per_page: int) -> int:
	return 0 if per_page <= 0 else maxi(0, index) / per_page


## How many tiles page `page` holds.
static func count_on_page(n: int, page: int, per_page: int) -> int:
	return clampi(n - page * per_page, 0, per_page)


## The centre of slot `slot` (0 = top left, reading order) on a
## `cols` × `rows` grid, in panel coordinates.
static func tile_center(slot: int, cols: int, rows: int) -> Vector2:
	var c := slot % maxi(1, cols)
	var r := slot / maxi(1, cols)
	var x := (float(c) - (cols - 1) / 2.0) * (TILE_W + GAP)
	var y := GRID_Y + ((rows - 1) / 2.0 - float(r)) * (TILE_H + GAP)
	return Vector2(x, y)


## The slot under panel point `p` on a page of `count` tiles, else -1.
static func slot_at(p: Vector2, cols: int, rows: int, count: int) -> int:
	for slot in mini(count, cols * rows):
		var c := tile_center(slot, cols, rows)
		if absf(p.x - c.x) <= TILE_W / 2.0 and absf(p.y - c.y) <= TILE_H / 2.0:
			return slot
	return -1


## The id of the button (`{id, center: Vector2, size: Vector2}`) under
## panel point `p`, else "". Later buttons win (drawn on top).
static func button_at(p: Vector2, buttons: Array) -> String:
	for i in range(buttons.size() - 1, -1, -1):
		var b: Dictionary = buttons[i]
		var c: Vector2 = b["center"]
		var s: Vector2 = b["size"]
		if absf(p.x - c.x) <= s.x / 2.0 and absf(p.y - c.y) <= s.y / 2.0:
			return str(b["id"])
	return ""


## Where a ray (`origin`, `dir`, world frame) meets the panel at
## `panel` (its global transform; the panel faces its +z): `{point:
## Vector2 (panel coordinates), at: Vector3 (world), distance}`, or `{}`
## when the ray runs parallel, points away or starts behind the panel.
static func ray_to_panel(origin: Vector3, dir: Vector3, panel: Transform3D) -> Dictionary:
	if dir.length_squared() < 1e-12:
		return {}
	var d := dir.normalized()
	var normal := panel.basis.z.normalized()
	var denom := d.dot(normal)
	if denom > -1e-4:
		return {}  # parallel, or pointing out of the panel's back
	var t := (panel.origin - origin).dot(normal) / denom
	if t < 0.0:
		return {}
	var at := origin + d * t
	var local := panel.affine_inverse() * at
	return {"point": Vector2(local.x, local.y), "at": at, "distance": t}
