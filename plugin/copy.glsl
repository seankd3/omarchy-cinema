// A texture's level over the framebuffer (`size`), dithered into its 8 bits:
// the frost (main.cpp, frost()). A blit cost more (0.31 against 0.24 ms).
uniform sampler2D source;
uniform float level;
uniform vec2 size;
out vec4 fragColor;
void main() {
    fragColor = textureLod(source, gl_FragCoord.xy / size, level) + vec4(vec3(cinemaDither()), 0.0);
}
