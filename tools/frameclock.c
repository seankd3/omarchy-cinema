// A Wayland compositor without a screen, for one nested compositor (a hidden
// Hyprland): it names the GPU's render node and the formats it renders to
// through linux-dmabuf feedback, takes each frame and asks for the next on a
// fixed 60 Hz vblank, as a display does: a frame committed between two vblanks
// is shown from the second. Nothing is shown, but each frame is read: the
// buffer the nested compositor hands over, which is what a display would scan
// out. Its screencopy (grim) copies the frame before Hyprland's last pass into
// that buffer, so it can move while the screen holds still (issue 43).
//
//   frameclock <socket-name> <width>x<height> [log]
//
// With a log, it writes the vblank grid ("p <period ns> <epoch ns>"), the
// vblanks passed so far at each wakeup on it ("v <count>"), and each commit of
// a buffer ("c <ns> <digest>": the digest is a hash of the frame read back at
// a sixteenth of its size each way, so two frames with the same digest look
// the same), on CLOCK_MONOTONIC, appending a line at a time so other writers
// can share the file (tools/smoothness and tools/fresh-user read it; a
// vblank past the last count means the log stopped, not that a frame was
// missed).
//
// Every object a client makes is accepted through one dispatcher that reads
// the protocol's own message tables: a request creates the objects its
// signature names and a "destroy" or "release" ends its object. Only the few
// requests below change anything. Once a second until the first frame it
// pings its client and tells each window its size again (see beat).
// tools/hidden-desktop builds and runs it.

#define _GNU_SOURCE
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>
#include <GLES2/gl2ext.h> // after gl3.h, which it needs
#include <fcntl.h>
#include <gbm.h>
#include <glob.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/timerfd.h>
#include <time.h>
#include <unistd.h>
#include <wayland-server.h>
#include "linux-dmabuf-v1-server-protocol.h"
#include "xdg-shell-server-protocol.h"

// The rate the nested Hyprland believes its Wayland output has.
#define HZ 60

static struct {
    int width, height;
    dev_t device;
    int table;      // the format table: { u32 format, u32 pad, u64 modifier } rows
    size_t entries;
    uint32_t serial;
    struct wl_list due;       // frame callbacks committed, answered at the next vblank
    struct wl_list shells;    // xdg_wm_base objects, pinged every beat
    struct wl_list toplevels; // xdg_toplevel objects (their xdg_surface as user data), configured every beat
    struct wl_event_source *beat;
    int log;                  // -1 without a log
    uint64_t vblanks;         // passed since the grid's epoch
    EGLDisplay egl;           // the render node's, current with a context, for reading frames
    GLuint read, small, texture; // the frame's framebuffer, the small copy's, and the frame's texture
    PFNEGLCREATEIMAGEKHRPROC create_image;
    PFNEGLDESTROYIMAGEKHRPROC destroy_image;
    PFNGLEGLIMAGETARGETTEXTURE2DOESPROC image_texture;
} fc;

// A surface's state between commits: its frame callbacks and attached buffer.
struct surface {
    struct wl_list frames, attached;
};

// A dmabuf as its params gather it, and as its wl_buffer keeps it, imported.
#define PLANES 4
struct params {
    int fds[PLANES];
    uint32_t offsets[PLANES], strides[PLANES];
    uint64_t modifier;
};
struct frame {
    EGLImageKHR image;
    int width, height;
};

// The frame read back at a sixteenth of its size each way.
#define SHRINK 16

static void detach(struct wl_resource *r) {
    wl_list_remove(wl_resource_get_link(r));
    wl_list_init(wl_resource_get_link(r));
}

static void move(struct wl_resource *r, struct wl_list *to) {
    detach(r);
    wl_list_insert(to->prev, wl_resource_get_link(r));
}

static void destroyed(struct wl_resource *r) {
    detach(r);
    const char *class = wl_resource_get_class(r);
    if (!strcmp(class, "xdg_surface")) {
        // Its window is configured through it, so no longer.
        struct wl_resource *t, *next;
        wl_resource_for_each_safe(t, next, &fc.toplevels) if (wl_resource_get_user_data(t) == r) detach(t);
        return;
    }
    if (!strcmp(class, "zwp_linux_buffer_params_v1")) {
        struct params *p = wl_resource_get_user_data(r);
        for (int i = 0; p && i < PLANES; i++)
            if (p->fds[i] >= 0)
                close(p->fds[i]);
        free(p);
        return;
    }
    if (!strcmp(class, "wl_buffer")) {
        struct frame *f = wl_resource_get_user_data(r);
        if (f && f->image != EGL_NO_IMAGE_KHR)
            fc.destroy_image(fc.egl, f->image);
        free(f);
        return;
    }
    struct surface *s = wl_resource_get_user_data(r);
    if (!s || strcmp(class, "wl_surface"))
        return;
    struct wl_resource *x, *next;
    wl_resource_for_each_safe(x, next, &s->frames) wl_list_init(wl_resource_get_link(x));
    wl_resource_for_each_safe(x, next, &s->attached) wl_list_init(wl_resource_get_link(x));
    free(s);
}

static int dispatch(const void *impl, void *target, uint32_t opcode, const struct wl_message *msg, union wl_argument *args);

static struct wl_resource *make(struct wl_client *client, const struct wl_interface *iface, int version, uint32_t id) {
    struct wl_resource *r = wl_resource_create(client, iface, version, id);
    if (!r) {
        wl_client_post_no_memory(client);
        return NULL;
    }
    wl_list_init(wl_resource_get_link(r));
    void *data = NULL;
    if (iface == &wl_surface_interface) {
        struct surface *s = calloc(1, sizeof *s);
        wl_list_init(&s->frames);
        wl_list_init(&s->attached);
        data = s;
    }
    wl_resource_set_dispatcher(r, dispatch, NULL, data, destroyed);
    return r;
}

static long long monotonic(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return now.tv_sec * 1000000000LL + now.tv_nsec;
}

static void note(const char *line) {
    if (fc.log >= 0 && write(fc.log, line, strlen(line)) < 0)
        fc.log = -1;
}

// A vblank: the frames committed since the last one are on screen now.
static int answer(int fd, uint32_t mask, void *unused) {
    uint64_t expirations;
    if (read(fd, &expirations, sizeof expirations) < 0)
        return 0;
    fc.vblanks += expirations;
    char line[64];
    snprintf(line, sizeof line, "v %llu\n", (unsigned long long)fc.vblanks);
    note(line);
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    uint32_t ms = now.tv_sec * 1000 + now.tv_nsec / 1000000;
    struct wl_resource *r, *next;
    wl_resource_for_each_safe(r, next, &fc.due) {
        wl_callback_send_done(r, ms);
        wl_resource_destroy(r);
    }
    return 0;
}

static void configure(struct wl_resource *toplevel) {
    struct wl_array states;
    wl_array_init(&states);
    *(uint32_t *)wl_array_add(&states, sizeof(uint32_t)) = XDG_TOPLEVEL_STATE_ACTIVATED;
    xdg_toplevel_send_configure(toplevel, fc.width, fc.height, &states);
    wl_array_release(&states);
    xdg_surface_send_configure(wl_resource_get_user_data(toplevel), ++fc.serial);
}

// The client's state is restated once a second, as a compositor's pings and
// resizes would. Aquamarine reads its socket only when something arrives and
// queues its first window's requests without sending them, so the ping wakes
// it to send them. It also creates that window's output, and starts listening
// for its size, only after reading what came back to those requests: a
// configure read with them is lost and the screen stays unsized, so each
// window is told its size again, until a frame shows it has one.
static int beat(void *unused) {
    struct wl_resource *r;
    wl_resource_for_each(r, &fc.shells) xdg_wm_base_send_ping(r, ++fc.serial);
    wl_resource_for_each(r, &fc.toplevels) configure(r);
    wl_event_source_timer_update(fc.beat, 1000);
    return 0;
}

static void feedback(struct wl_resource *f) {
    struct wl_array device = {.size = sizeof fc.device, .alloc = 0, .data = &fc.device};
    zwp_linux_dmabuf_feedback_v1_send_format_table(f, fc.table, fc.entries * 16);
    zwp_linux_dmabuf_feedback_v1_send_main_device(f, &device);
    zwp_linux_dmabuf_feedback_v1_send_tranche_target_device(f, &device);
    zwp_linux_dmabuf_feedback_v1_send_tranche_flags(f, 0);
    struct wl_array indices;
    wl_array_init(&indices);
    for (uint16_t i = 0; i < fc.entries; i++)
        *(uint16_t *)wl_array_add(&indices, sizeof i) = i;
    zwp_linux_dmabuf_feedback_v1_send_tranche_formats(f, &indices);
    wl_array_release(&indices);
    zwp_linux_dmabuf_feedback_v1_send_tranche_done(f);
    zwp_linux_dmabuf_feedback_v1_send_done(f);
}

// A params object's planes, gathered as they are added.
static struct params *planes(struct wl_resource *r) {
    struct params *p = wl_resource_get_user_data(r);
    if (!p && (p = calloc(1, sizeof *p))) {
        for (int i = 0; i < PLANES; i++)
            p->fds[i] = -1;
        wl_resource_set_user_data(r, p);
    }
    return p;
}

// The buffer made from params `r`, imported for reading when a log wants
// its frames.
static struct frame *import(struct wl_resource *r, int32_t width, int32_t height, uint32_t format) {
    struct params *p = wl_resource_get_user_data(r);
    struct frame *f = calloc(1, sizeof *f);
    if (!f)
        return NULL;
    *f = (struct frame){EGL_NO_IMAGE_KHR, width, height};
    if (!p || fc.log < 0)
        return f;
    static const EGLint keys[PLANES][5] = {
        {EGL_DMA_BUF_PLANE0_FD_EXT, EGL_DMA_BUF_PLANE0_OFFSET_EXT, EGL_DMA_BUF_PLANE0_PITCH_EXT, EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT},
        {EGL_DMA_BUF_PLANE1_FD_EXT, EGL_DMA_BUF_PLANE1_OFFSET_EXT, EGL_DMA_BUF_PLANE1_PITCH_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE1_MODIFIER_HI_EXT},
        {EGL_DMA_BUF_PLANE2_FD_EXT, EGL_DMA_BUF_PLANE2_OFFSET_EXT, EGL_DMA_BUF_PLANE2_PITCH_EXT, EGL_DMA_BUF_PLANE2_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE2_MODIFIER_HI_EXT},
        {EGL_DMA_BUF_PLANE3_FD_EXT, EGL_DMA_BUF_PLANE3_OFFSET_EXT, EGL_DMA_BUF_PLANE3_PITCH_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_LO_EXT, EGL_DMA_BUF_PLANE3_MODIFIER_HI_EXT},
    };
    EGLint attribs[7 + PLANES * 10] = {EGL_WIDTH, width, EGL_HEIGHT, height, EGL_LINUX_DRM_FOURCC_EXT, (EGLint)format};
    int n = 6;
    for (int i = 0; i < PLANES && p->fds[i] >= 0; i++) {
        const EGLint values[5] = {p->fds[i], (EGLint)p->offsets[i], (EGLint)p->strides[i], (EGLint)(p->modifier & 0xffffffff), (EGLint)(p->modifier >> 32)};
        for (int k = 0; k < 5; k++) {
            attribs[n++] = keys[i][k];
            attribs[n++] = values[k];
        }
    }
    attribs[n] = EGL_NONE;
    f->image = fc.create_image(fc.egl, EGL_NO_CONTEXT, EGL_LINUX_DMA_BUF_EXT, NULL, attribs);
    return f;
}

// A frame's digest: FNV-1a over the frame drawn at a sixteenth of its size
// each way (linear filtering, so every pixel of it counts a little), as
// RGBA8. 0 is a frame that could not be read.
static uint64_t digest(const struct frame *f) {
    if (!f || f->image == EGL_NO_IMAGE_KHR)
        return 0;
    const int w = f->width / SHRINK > 0 ? f->width / SHRINK : 1, h = f->height / SHRINK > 0 ? f->height / SHRINK : 1;
    static int shrunk[2];
    static uint8_t *pixels;
    if (shrunk[0] != w || shrunk[1] != h) {
        GLuint rb;
        glGenRenderbuffers(1, &rb);
        glBindRenderbuffer(GL_RENDERBUFFER, rb);
        glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, w, h);
        glBindFramebuffer(GL_DRAW_FRAMEBUFFER, fc.small);
        glFramebufferRenderbuffer(GL_DRAW_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, rb);
        free(pixels);
        pixels = malloc((size_t)w * h * 4);
        shrunk[0] = w, shrunk[1] = h;
    }
    glBindTexture(GL_TEXTURE_2D, fc.texture);
    fc.image_texture(GL_TEXTURE_2D, f->image);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, fc.read);
    glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fc.texture, 0);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, fc.small);
    glBlitFramebuffer(0, 0, f->width, f->height, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_LINEAR);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, fc.small);
    glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    if (glGetError() != GL_NO_ERROR)
        return 0;
    uint64_t hash = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < (size_t)w * h * 4; i++)
        hash = (hash ^ pixels[i]) * 0x100000001b3ULL;
    return hash ? hash : 1;
}

// What the requests that matter do, after the dispatcher has made any object
// they create (`made`).
static void act(struct wl_resource *r, const char *request, union wl_argument *args, struct wl_resource *made) {
    struct surface *s = wl_resource_get_user_data(r);
    if (!strcmp(request, "wl_surface.attach")) {
        struct wl_resource *buffer = (struct wl_resource *)args[0].o;
        struct wl_resource *x, *next;
        wl_resource_for_each_safe(x, next, &s->attached) detach(x);
        if (buffer)
            move(buffer, &s->attached);
    } else if (!strcmp(request, "wl_surface.frame")) {
        move(made, &s->frames);
    } else if (!strcmp(request, "wl_surface.commit")) {
        // A buffer is a new frame. It is read here, at once, so it is free
        // again as soon as it is committed.
        if (!wl_list_empty(&s->attached)) {
            wl_event_source_timer_update(fc.beat, 0);
            const long long at = monotonic();
            const uint64_t seen = digest(wl_resource_get_user_data(wl_resource_from_link(s->attached.next)));
            char line[80];
            snprintf(line, sizeof line, "c %lld %016llx\n", at, (unsigned long long)seen);
            note(line);
        }
        struct wl_resource *x, *next;
        wl_resource_for_each_safe(x, next, &s->attached) {
            detach(x);
            wl_buffer_send_release(x);
        }
        wl_resource_for_each_safe(x, next, &s->frames) move(x, &fc.due);
    } else if (!strcmp(request, "xdg_surface.get_toplevel")) {
        wl_resource_set_user_data(made, r);
        move(made, &fc.toplevels);
        configure(made);
    } else if (!strcmp(request, "zwp_linux_buffer_params_v1.add")) {
        struct params *p = planes(r);
        const uint32_t plane = args[1].u;
        if (p && plane < PLANES && p->fds[plane] < 0) {
            p->fds[plane] = dup(args[0].h);
            p->offsets[plane] = args[2].u;
            p->strides[plane] = args[3].u;
            p->modifier = (uint64_t)args[4].u << 32 | args[5].u;
        }
    } else if (!strcmp(request, "zwp_linux_buffer_params_v1.create")) {
        struct wl_resource *buffer = make(wl_resource_get_client(r), &wl_buffer_interface, 1, 0);
        if (buffer) {
            wl_resource_set_user_data(buffer, import(r, args[0].i, args[1].i, args[2].u));
            zwp_linux_buffer_params_v1_send_created(r, buffer);
        }
    } else if (!strcmp(request, "zwp_linux_buffer_params_v1.create_immed")) {
        wl_resource_set_user_data(made, import(r, args[1].i, args[2].i, args[3].u));
    } else if (!strcmp(request, "zwp_linux_dmabuf_v1.get_default_feedback") ||
               !strcmp(request, "zwp_linux_dmabuf_v1.get_surface_feedback")) {
        feedback(made);
    }
}

static int dispatch(const void *impl, void *target, uint32_t opcode, const struct wl_message *msg, union wl_argument *args) {
    struct wl_resource *r = target;
    struct wl_resource *made = NULL;
    int arg = 0;
    for (const char *c = msg->signature; *c; c++) {
        if (*c == '?' || (*c >= '0' && *c <= '9'))
            continue;
        if (*c == 'n' && msg->types[arg])
            if (!(made = make(wl_resource_get_client(r), msg->types[arg], wl_resource_get_version(r), args[arg].n)))
                return 0;
        arg++;
    }

    char request[128];
    snprintf(request, sizeof request, "%s.%s", wl_resource_get_class(r), msg->name);
    act(r, request, args, made);

    // A received file descriptor is the handler's to close, and nothing here
    // keeps one.
    arg = 0;
    for (const char *c = msg->signature; *c; c++) {
        if (*c == '?' || (*c >= '0' && *c <= '9'))
            continue;
        if (*c == 'h')
            close(args[arg].h);
        arg++;
    }

    if (!strcmp(msg->name, "destroy") || !strcmp(msg->name, "release"))
        wl_resource_destroy(r);
    return 0;
}

static void bind(struct wl_client *client, void *data, uint32_t version, uint32_t id) {
    struct wl_resource *r = make(client, data, version, id);
    if (!r)
        return;
    if (data == &wl_seat_interface) {
        wl_seat_send_capabilities(r, 0);
        wl_seat_send_name(r, "frameclock");
    } else if (data == &wl_shm_interface) {
        wl_shm_send_format(r, WL_SHM_FORMAT_ARGB8888);
        wl_shm_send_format(r, WL_SHM_FORMAT_XRGB8888);
    } else if (data == &xdg_wm_base_interface) {
        move(r, &fc.shells);
        wl_event_source_timer_update(fc.beat, 1000);
    }
}

// The formats and modifiers the GPU renders to, as its EGL reports them;
// its EGL then stays, to read frames with.
static int formats(int node) {
    struct gbm_device *gbm = gbm_create_device(node);
    EGLDisplay egl = gbm ? eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, gbm, NULL) : EGL_NO_DISPLAY;
    if (egl == EGL_NO_DISPLAY || !eglInitialize(egl, NULL, NULL))
        return -1;
    PFNEGLQUERYDMABUFFORMATSEXTPROC query_formats = (void *)eglGetProcAddress("eglQueryDmaBufFormatsEXT");
    PFNEGLQUERYDMABUFMODIFIERSEXTPROC query_modifiers = (void *)eglGetProcAddress("eglQueryDmaBufModifiersEXT");
    if (!query_formats || !query_modifiers)
        return -1;

    EGLint count = 0;
    query_formats(egl, 0, NULL, &count);
    EGLint *list = calloc(count, sizeof *list);
    query_formats(egl, count, list, &count);

    fc.table = memfd_create("frameclock-formats", MFD_CLOEXEC);
    for (EGLint i = 0; i < count; i++) {
        EGLint n = 0;
        query_modifiers(egl, list[i], 0, NULL, NULL, &n);
        EGLuint64KHR *mods = calloc(n, sizeof *mods);
        EGLBoolean *external = calloc(n, sizeof *external);
        query_modifiers(egl, list[i], n, mods, external, &n);
        for (EGLint m = 0; m < n; m++) {
            if (external[m])
                continue;
            struct { uint32_t format, pad; uint64_t modifier; } row = {list[i], 0, mods[m]};
            if (write(fc.table, &row, sizeof row) != sizeof row)
                return -1;
            fc.entries++;
        }
        free(mods);
        free(external);
    }
    free(list);
    if (!fc.entries)
        return -1;

    // The same display, kept with a context current, reads the frames.
    static const EGLint version[] = {EGL_CONTEXT_MAJOR_VERSION, 3, EGL_NONE};
    fc.create_image = (void *)eglGetProcAddress("eglCreateImageKHR");
    fc.destroy_image = (void *)eglGetProcAddress("eglDestroyImageKHR");
    fc.image_texture = (void *)eglGetProcAddress("glEGLImageTargetTexture2DOES");
    EGLContext context = EGL_NO_CONTEXT;
    if (fc.create_image && fc.destroy_image && fc.image_texture && eglBindAPI(EGL_OPENGL_ES_API))
        context = eglCreateContext(egl, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, version);
    if (context == EGL_NO_CONTEXT || !eglMakeCurrent(egl, EGL_NO_SURFACE, EGL_NO_SURFACE, context)) {
        fprintf(stderr, "frameclock: no GL context to read frames with\n");
        return -1;
    }
    fc.egl = egl;
    glGenFramebuffers(1, &fc.read);
    glGenFramebuffers(1, &fc.small);
    glGenTextures(1, &fc.texture);
    return 0;
}

int main(int argc, char **argv) {
    if ((argc != 3 && argc != 4) || sscanf(argv[2], "%dx%d", &fc.width, &fc.height) != 2) {
        fprintf(stderr, "usage: frameclock <socket-name> <width>x<height> [log]\n");
        return 2;
    }
    fc.log = argc == 4 ? open(argv[3], O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644) : -1;

    glob_t nodes;
    if (glob("/dev/dri/renderD*", 0, NULL, &nodes) || !nodes.gl_pathc) {
        fprintf(stderr, "frameclock: no render node\n");
        return 1;
    }
    struct stat st;
    int node = open(nodes.gl_pathv[0], O_RDWR | O_CLOEXEC);
    if (node < 0 || fstat(node, &st) || formats(node)) {
        fprintf(stderr, "frameclock: %s gives no render formats\n", nodes.gl_pathv[0]);
        return 1;
    }
    fc.device = st.st_rdev;
    globfree(&nodes);

    struct wl_display *display = wl_display_create();
    if (wl_display_add_socket(display, argv[1])) {
        fprintf(stderr, "frameclock: cannot listen on %s\n", argv[1]);
        return 1;
    }
    wl_list_init(&fc.due);
    wl_list_init(&fc.shells);
    wl_list_init(&fc.toplevels);
    struct wl_event_loop *loop = wl_display_get_event_loop(display);
    // The vblanks: every period from now, however late a wakeup is.
    const long long period = 1000000000LL / HZ, epoch = monotonic() + period;
    int vblank = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC | TFD_NONBLOCK);
    struct itimerspec grid = {.it_interval = {0, period}, .it_value = {epoch / 1000000000LL, epoch % 1000000000LL}};
    if (vblank < 0 || timerfd_settime(vblank, TFD_TIMER_ABSTIME, &grid, NULL)) {
        fprintf(stderr, "frameclock: no vblank timer\n");
        return 1;
    }
    wl_event_loop_add_fd(loop, vblank, WL_EVENT_READABLE, answer, NULL);
    char line[64];
    snprintf(line, sizeof line, "p %lld %lld\n", period, epoch);
    note(line);
    fc.beat = wl_event_loop_add_timer(loop, beat, NULL);
    // The versions the nested compositor binds (Aquamarine's Wayland backend).
    static const struct { const struct wl_interface *iface; int version; } globals[] = {
        {&wl_compositor_interface, 6}, {&wl_shm_interface, 1}, {&wl_seat_interface, 9},
        {&xdg_wm_base_interface, 6}, {&zwp_linux_dmabuf_v1_interface, 4},
    };
    for (size_t i = 0; i < sizeof globals / sizeof *globals; i++)
        wl_global_create(display, globals[i].iface, globals[i].version, (void *)globals[i].iface, bind);
    wl_display_run(display);
    return 0;
}
