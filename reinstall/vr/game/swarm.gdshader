// A ghost's glitchy swarm: the port of `@loom/house/three`'s `swarm.ts`
// shader (the story of what it does is there). Change both together.
//
// Unlit opaque shards cut with `discard`: no sorting, no overdraw, the same
// shader for every ghost. Godot's instance data has fewer slots than three's
// attributes, so a shard is packed: the instance transform's origin is its
// home and its basis its size, COLOR is its piece of the picture, and
// INSTANCE_CUSTOM its four random values (the last + 1 on a face shard).
// Everything is in world space: `origin` is the ghost.
shader_type spatial;
render_mode unshaded, skip_vertex_transform, cull_disabled, shadows_disabled;

const int TRAIL = 8;
const float STEP_HZ = 11.0;
const float STORM_S = 0.9;
const float FACE_GRID = 9.0;
const float FACE_SIZE = 0.56;
const float FACE_Y = 1.5;
const float HEIGHT = 1.6;

uniform sampler2D map : source_color, filter_linear_mipmap, repeat_disable;
uniform bool worn = false;
uniform vec3 tint : source_color = vec3(0.24, 0.95, 0.91);
uniform float swarm_seed = 0.0;
// The player's own hand (`hand_swarm.gd`): the swarm's size, and whether the
// face gathers for a nearby camera (a hand is always near one).
uniform float swarm_scale = 1.0;
uniform float near_weight = 1.0;
// The share of the shards drawn (the `self` vision's fade).
uniform float present = 1.0;
uniform vec3 origin = vec3(0.0);
uniform vec3 look = vec3(0.0, 0.0, -1.0);
uniform vec3 trail[TRAIL];

varying vec2 v_uv;
varying float v_burn;

float hash(float n) {
	return fract(sin(n) * 43758.5453);
}

float noise(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 trail_at(float lag) {
	float f = clamp(lag, 0.0, 1.0) * float(TRAIL - 1);
	int i = int(floor(f));
	return mix(trail[i], trail[i < TRAIL - 1 ? i + 1 : i], f - floor(f));
}

void vertex() {
	vec2 corner = VERTEX.xy;
	vec3 home = MODEL_MATRIX[3].xyz - origin;
	vec2 size = vec2(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz));
	vec4 cell = COLOR;
	vec4 rnd = INSTANCE_CUSTOM;

	float is_face = step(1.0, rnd.w);
	float r = rnd.w - is_face;
	float tick = floor(TIME * STEP_HZ + rnd.x * 3.0);
	float t = tick / STEP_HZ;
	float slot = floor(TIME / STORM_S + swarm_seed);
	float storm = step(0.7, hash(slot * 1.37 + swarm_seed));

	float radius = length(home.xz);
	float dir = rnd.y < 0.5 ? -1.0 : 1.0;
	float angle = atan(home.z, home.x) + dir * t * (0.4 + 1.4 * rnd.z);
	float y = home.y + 0.05 * sin(t * (1.0 + 3.0 * rnd.y) + rnd.z * TAU);
	radius *= 0.85 + 0.3 * hash(tick * 0.13 + rnd.y * 37.0);

	float drip = step(0.8, r) * (1.0 - is_face);
	if (drip > 0.5) {
		float p = fract(t * (0.1 + 0.2 * rnd.z) + rnd.x);
		y *= 1.0 - p * p;
		radius += p * p * p * 0.5;
	}

	float lag = (1.0 - y / HEIGHT) * 0.55 + rnd.y * 0.45;
	vec3 body = vec3(cos(angle) * radius, y, sin(angle) * radius) * swarm_scale + trail_at(lag);

	float away = step(1.0 - mix(0.01, 0.12, storm), hash(tick * 0.37 + rnd.y * 91.0));
	if (away > 0.5) {
		float a = hash(tick + rnd.z * 11.0) * TAU;
		float d = 0.3 + 0.7 * hash(tick * 0.71 + rnd.x * 5.0);
		body += vec3(cos(a) * d, (hash(tick * 0.23 + r) - 0.5) * 0.6, sin(a) * d) * swarm_scale;
	}
	body.x += storm * (hash(floor(y * 14.0) + tick * 0.5) - 0.5) * 0.3 * swarm_scale;

	vec4 view = VIEW_MATRIX * vec4(origin + body, 1.0);

	vec3 head_at = (vec3(0.0, FACE_Y, 0.0) + look * 0.12) * swarm_scale + trail_at(0.1);
	vec4 head = VIEW_MATRIX * vec4(origin + head_at, 1.0);
	float near = near_weight * (1.0 - smoothstep(2.2, 4.6, length(head.xyz)));
	float mood = smoothstep(0.15, 0.7, sin(t * 0.7 + swarm_seed * 3.0));
	float gather = clamp(max(mood, near) - 0.3 * storm, 0.0, 1.0);
	float g = is_face * smoothstep(rnd.y * 0.6, rnd.y * 0.6 + 0.4, gather);
	vec2 face_at = (cell.xy + cell.zw * 0.5 - 0.5) * FACE_SIZE;
	float row = floor(cell.y * FACE_GRID + 0.5);
	float row_tick = floor(TIME * STEP_HZ);
	float tear = step(mix(0.9, 0.55, storm), hash(row * 3.1 + row_tick * 0.17 + swarm_seed));
	face_at.x += tear * (hash(row + row_tick * 0.31) - 0.5) * 0.42;
	vec4 face = head + vec4(face_at, rnd.z * 0.03, 0.0) * swarm_scale;
	view = mix(view, face, g);

	float big = 1.0 + (1.0 - g) * storm * step(0.8, rnd.z) * 1.5;
	float here = step(rnd.x * 0.999, present);
	view.xy += corner * size * big * swarm_scale * here;
	VERTEX = view.xyz;

	// The layout's v is up (three's); a Godot texture's is down.
	float wrong = storm * step(0.65, hash(tick * 0.11 + rnd.z * 17.0));
	float left = wrong > 0.5 ? mod(cell.x + hash(rnd.x * 23.0), 1.0 - cell.z) : cell.x;
	vec2 uv = vec2(left, cell.y) + (corner + 0.5) * cell.zw;
	v_uv = vec2(uv.x, 1.0 - uv.y);
	v_burn = wrong + (1.0 - wrong) * storm * step(0.8, rnd.y);
}

void fragment() {
	vec3 c;
	if (worn) {
		vec4 tex = texture(map, v_uv);
		if (tex.a < 0.4) {
			discard;
		}
		c = tex.rgb;
		if (v_burn > 0.5) {
			c.r = texture(map, v_uv + vec2(0.04, 0.0)).r;
			c.b = texture(map, v_uv - vec2(0.04, 0.0)).b;
		}
	} else {
		c = tint * (0.25 + 0.75 * noise(floor(v_uv * 48.0)));
	}
	ALBEDO = c;
}
