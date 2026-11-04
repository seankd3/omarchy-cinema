// The pace program's main: the film's pace at the middle of each tile of the
// screen, one texel a tile, which the plugin reads back (contract.glsl,
// pace()).
void main() {
    fragColor = vec4(clamp(ceil(pace(v_px)), 0.0, EVERY_FRAME) / 255.0);
}
