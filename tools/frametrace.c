// Preloaded into the hidden desktop's Hyprland (tools/hidden-desktop): each
// time the backdrop plugin sets its backdrop program's `time`, it appends
// "t <ns> <seconds>" to $FRAMETRACE (CLOCK_MONOTONIC), so the backdrop's time
// in each frame can be read beside frameclock's commits (tools/smoothness).
// The plugin itself is not changed: this watches the GL calls it makes.
//
// The backdrop's program is the one that has a `time` and a `windowData` but
// no `frameWindow` (the frame's program has all three; Hyprland's have none).

#define _GNU_SOURCE
#include <GLES3/gl32.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define PROGRAMS 64

static struct {
    GLuint program;
    GLint  time;
    int    data, frame;
} programs[PROGRAMS];
static GLuint current;
static int    out = -2;

static int slot(GLuint program) {
    return program % PROGRAMS;
}

GLint glGetUniformLocation(GLuint program, const GLchar* name) {
    static GLint (*next)(GLuint, const GLchar*);
    if (!next)
        next = dlsym(RTLD_NEXT, "glGetUniformLocation");
    const GLint at = next(program, name);
    const int   s  = slot(program);
    if (programs[s].program != program)
        programs[s] = (typeof(programs[s])){.program = program, .time = -1};
    if (!strcmp(name, "time"))
        programs[s].time = at;
    else if (!strcmp(name, "windowData"))
        programs[s].data = at >= 0;
    else if (!strcmp(name, "frameWindow"))
        programs[s].frame = at >= 0;
    return at;
}

void glUseProgram(GLuint program) {
    static void (*next)(GLuint);
    if (!next)
        next = dlsym(RTLD_NEXT, "glUseProgram");
    current = program;
    next(program);
}

void glUniform1f(GLint location, GLfloat value) {
    static void (*next)(GLint, GLfloat);
    if (!next)
        next = dlsym(RTLD_NEXT, "glUniform1f");
    const int s = slot(current);
    if (current && programs[s].program == current && programs[s].data && !programs[s].frame && location >= 0 && location == programs[s].time) {
        if (out == -2) {
            const char* path = getenv("FRAMETRACE");
            out              = path ? open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644) : -1;
        }
        if (out >= 0) {
            struct timespec now;
            clock_gettime(CLOCK_MONOTONIC, &now);
            char      line[64];
            const int n = snprintf(line, sizeof line, "t %lld %.6f\n", now.tv_sec * 1000000000LL + now.tv_nsec, value);
            if (write(out, line, n) < 0)
                out = -1;
        }
    }
    next(location, value);
}
