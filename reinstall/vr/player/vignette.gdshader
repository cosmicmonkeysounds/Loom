// Comfort vignette: darkens the edge of view while the player moves or
// turns. Drawn as a full-screen quad in clip space but measured from where
// each eye looks: a Quest's eye buffers are off-centre by 17 degrees, outwards,
// so a ring round the buffer's middle lands 34 degrees apart in the two eyes
// and cannot be fused. Measured this way a direction is as dark in one eye as
// in the other, and the ring sits at infinity.
shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, cull_disabled, blend_mix, shadows_disabled;

// 0 = off, 1 = the tightest tunnel.
uniform float strength : hint_range(0.0, 1.0) = 0.0;

// Half the tangent of the view's width, so that r = 1 sits 50 degrees out.
const float HALF_WIDTH = 1.21;

varying vec2 off_axis;

void vertex() {
	// A 2×2 QuadMesh: VERTEX.xy is already in [-1, 1].
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
	vec4 ahead = PROJECTION_MATRIX * vec4(0.0, 0.0, -100.0, 1.0);
	off_axis = (VERTEX.xy - ahead.xy / ahead.w) / vec2(PROJECTION_MATRIX[0][0], PROJECTION_MATRIX[1][1]);
}

void fragment() {
	float r = length(off_axis) / HALF_WIDTH;
	float inner = mix(1.35, 0.55, strength);
	float a = smoothstep(inner, inner + 0.45, r) * clamp(strength * 1.6, 0.0, 1.0);
	ALBEDO = vec3(0.0);
	ALPHA = a;
}
