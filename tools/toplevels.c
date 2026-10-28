// Lists the compositor's windows as `identifier<TAB>app_id<TAB>title`, from
// ext-foreign-toplevel-list, so `grim -T <identifier>` can capture one window
// wherever it is, on a hidden workspace too, without focusing or showing it.
//
//   tools/toplevels            (tools/osd-preview builds it on first use)

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <wayland-client.h>
#include "ext-foreign-toplevel-list-v1-client-protocol.h"

struct window {
    char *identifier, *app_id, *title;
    struct window *next;
};

static struct ext_foreign_toplevel_list_v1 *list;
static struct window *windows;

static void set(char **field, const char *value) {
    free(*field);
    *field = strdup(value ? value : "");
}

static void on_title(void *data, struct ext_foreign_toplevel_handle_v1 *h, const char *title) {
    set(&((struct window *)data)->title, title);
}
static void on_app_id(void *data, struct ext_foreign_toplevel_handle_v1 *h, const char *app_id) {
    set(&((struct window *)data)->app_id, app_id);
}
static void on_identifier(void *data, struct ext_foreign_toplevel_handle_v1 *h, const char *id) {
    set(&((struct window *)data)->identifier, id);
}
static void on_done(void *data, struct ext_foreign_toplevel_handle_v1 *h) {}
static void on_closed(void *data, struct ext_foreign_toplevel_handle_v1 *h) {}

static const struct ext_foreign_toplevel_handle_v1_listener handle_listener = {
    .closed = on_closed,
    .done = on_done,
    .title = on_title,
    .app_id = on_app_id,
    .identifier = on_identifier,
};

static void on_toplevel(void *data, struct ext_foreign_toplevel_list_v1 *l,
                        struct ext_foreign_toplevel_handle_v1 *handle) {
    struct window *w = calloc(1, sizeof *w);
    w->next = windows;
    windows = w;
    ext_foreign_toplevel_handle_v1_add_listener(handle, &handle_listener, w);
}
static void on_finished(void *data, struct ext_foreign_toplevel_list_v1 *l) {}

static const struct ext_foreign_toplevel_list_v1_listener list_listener = {
    .toplevel = on_toplevel,
    .finished = on_finished,
};

static void on_global(void *data, struct wl_registry *registry, uint32_t name,
                      const char *interface, uint32_t version) {
    if (strcmp(interface, ext_foreign_toplevel_list_v1_interface.name) == 0) {
        list = wl_registry_bind(registry, name, &ext_foreign_toplevel_list_v1_interface, 1);
        ext_foreign_toplevel_list_v1_add_listener(list, &list_listener, NULL);
    }
}
static void on_global_remove(void *data, struct wl_registry *registry, uint32_t name) {}

static const struct wl_registry_listener registry_listener = {
    .global = on_global,
    .global_remove = on_global_remove,
};

int main(void) {
    struct wl_display *display = wl_display_connect(NULL);
    if (!display) {
        fprintf(stderr, "toplevels: no Wayland display\n");
        return 1;
    }
    wl_registry_add_listener(wl_display_get_registry(display), &registry_listener, NULL);
    wl_display_roundtrip(display); // the globals
    if (!list) {
        fprintf(stderr, "toplevels: the compositor has no ext-foreign-toplevel-list\n");
        return 1;
    }
    wl_display_roundtrip(display); // the windows
    wl_display_roundtrip(display); // their details
    for (struct window *w = windows; w; w = w->next)
        printf("%s\t%s\t%s\n", w->identifier ? w->identifier : "", w->app_id ? w->app_id : "",
               w->title ? w->title : "");
    return 0;
}
