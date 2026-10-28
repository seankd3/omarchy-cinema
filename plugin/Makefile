# Builds backdrop.so against the Hyprland that is installed. A Hyprland update
# needs a rebuild: the plugin refuses to load into another version.

BUILD   ?= build
DEPS    := hyprland libdrm libinput libudev pixman-1 wayland-server xkbcommon
CXXFLAGS = -std=c++23 -O2 -fPIC -fno-gnu-unique -I$(BUILD) $(shell pkg-config --cflags $(DEPS))
LDLIBS   = $(shell pkg-config --libs $(DEPS)) -lrt

$(BUILD)/backdrop.so: main.cpp $(BUILD)/contract.inc
	$(CXX) $(CXXFLAGS) -shared -o $@ main.cpp $(LDLIBS)

# The shader contract is compiled in, so a theme's shader and the uniforms the
# plugin sets always come from the same build.
$(BUILD)/contract.inc: contract.glsl
	mkdir -p $(BUILD)
	{ printf 'R"__contract__('; cat contract.glsl; printf ')__contract__"'; } > $@
