# The hidden desktops' helpers (tools/hidden-desktop, tools/check-shader-reload):
# frameclock, a Wayland compositor with no screen, and frametrace, which reads
# the time the plugin draws with.

BUILD := build
vpath %.xml /usr/share/wayland-protocols/stable/xdg-shell /usr/share/wayland-protocols/stable/linux-dmabuf
PROTOCOLS := xdg-shell linux-dmabuf-v1

all: $(BUILD)/frameclock $(BUILD)/frametrace.so

$(BUILD)/frameclock: frameclock.c $(PROTOCOLS:%=$(BUILD)/%-server-protocol.h) $(PROTOCOLS:%=$(BUILD)/%-protocol.c)
	gcc -O2 -I$(BUILD) -o $@ frameclock.c $(PROTOCOLS:%=$(BUILD)/%-protocol.c) $(shell pkg-config --cflags --libs wayland-server egl gbm glesv2)

$(BUILD)/%-server-protocol.h: %.xml
	@mkdir -p $(BUILD)
	wayland-scanner server-header $< $@

$(BUILD)/%-protocol.c: %.xml
	@mkdir -p $(BUILD)
	wayland-scanner private-code $< $@

$(BUILD)/frametrace.so: frametrace.c
	@mkdir -p $(BUILD)
	gcc -O2 -shared -fPIC -o $@ frametrace.c -ldl

.PHONY: all
