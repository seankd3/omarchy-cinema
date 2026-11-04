# Builds backdrop.so against the installed Hyprland, with the shader contract
# and the two mains a film's shader is linked with compiled in, and installs
# the engine in ENGINE: the plugin and film.lua. The package installs it in
# /usr/lib/omarchy-cinema, ./install in ~/.local/lib/omarchy-cinema.

BUILD   ?= build
ENGINE  ?= $(HOME)/.local/lib/omarchy-cinema
DEPS    := hyprland cairo libdrm libinput libudev pixman-1 wayland-server xkbcommon
CXXFLAGS = -std=c++23 -O2 -fPIC -fno-gnu-unique -I$(BUILD) $(shell pkg-config --cflags $(DEPS))
LDLIBS   = $(shell pkg-config --libs $(DEPS)) -lrt
VERSION := $(shell pkg-config --variable=prefix hyprland)/hyprland/src/version.h

$(BUILD)/backdrop.so: main.cpp $(BUILD)/contract.inc $(BUILD)/dither.inc $(BUILD)/main-backdrop.inc $(BUILD)/main-frame.inc $(BUILD)/copy.inc $(BUILD)/glass.inc $(BUILD)/hyprland
	$(CXX) $(CXXFLAGS) -shared -o $@ main.cpp $(LDLIBS)

# The plugin refuses to load into a Hyprland other than the one its headers
# describe, and a package's files keep their own dates, so this names the
# headers by their version file's content and changes only when it does.
$(BUILD)/hyprland: FORCE
	@mkdir -p $(BUILD)
	@sha256sum $(VERSION) | cmp -s - $@ || sha256sum $(VERSION) > $@

# The shader contract and the two mains a film's shader is linked with are
# compiled in, so a film and the uniforms the plugin sets always come from the
# same build; tools/preview.py reads the same files. The film itself is the
# applied theme's own backdrop.frag, read at every theme switch.
$(BUILD)/%.inc: %.glsl
	mkdir -p $(BUILD)
	{ printf 'R"__glsl__('; cat $<; printf ')__glsl__"'; } > $@

# A new file for the plugin, then renamed: Hyprland has the old one mapped.
install: $(BUILD)/backdrop.so
	install -d $(DESTDIR)$(ENGINE)
	install -m 755 $< $(DESTDIR)$(ENGINE)/backdrop.so.new
	mv $(DESTDIR)$(ENGINE)/backdrop.so.new $(DESTDIR)$(ENGINE)/backdrop.so
	install -m 644 ../film.lua $(DESTDIR)$(ENGINE)/film.lua

FORCE:
.PHONY: install FORCE
