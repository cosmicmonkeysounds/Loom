// Comfort vignette: darkens the edge of view while the player moves or
// turns. Drawn as a full-screen quad in clip space, so it is centred on
// each eye's own projection in XR and on the window on desktop.
shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, cull_disabled, blend_mix, shadows_disabled;

// 0 = off, 1 = the tightest tunnel.
uniform float strength : hint_range(0.0, 1.0) = 0.0;

void vertex() {
	// A 2×2 QuadMesh: VERTEX.xy is already in [-1, 1].
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

void fragment() {
	float r = length(UV - vec2(0.5)) * 2.0;
	float inner = mix(1.35, 0.55, strength);
	float a = smoothstep(inner, inner + 0.45, r) * clamp(strength * 1.6, 0.0, 1.0);
	ALBEDO = vec3(0.0);
	ALPHA = a;
}
