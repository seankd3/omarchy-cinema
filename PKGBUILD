# The engine of Omarchy Cinema: the backdrop plugin and film.lua, in
# /usr/lib/omarchy-cinema (plugin/Makefile's install). The films are theme
# directories; the plugin compiles the applied theme's backdrop.frag against
# its own contract at every theme switch. The plugin uses Hyprland's
# internals and refuses to load into any other build, so the package depends
# on exactly the Hyprland package it was built against, release included:
# pacman holds Hyprland back until the package is rebuilt for the new one
# (RELEASE.md, "Packaging"). OMARCHY_CINEMA_SOURCE builds another clone (a
# local checkout, with #branch=...) in place of the published one.

pkgname=omarchy-cinema-git
pkgver=r0
pkgrel=1
pkgdesc="Live film backdrops drawn around the windows for Omarchy (the Hyprland plugin)"
arch=(x86_64 aarch64)
url="https://github.com/seankd3/omarchy-cinema"
license=(MIT)
makedepends=(git 'hyprland>=0.57' cairo libdrm libinput pixman wayland libxkbcommon)
provides=(omarchy-cinema)
conflicts=(omarchy-cinema)
source=("omarchy-cinema::git+${OMARCHY_CINEMA_SOURCE:-$url.git}")
sha256sums=(SKIP)

pkgver() {
  cd omarchy-cinema
  printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)"
}

build() {
  make -C omarchy-cinema/plugin
}

package() {
  depends=("hyprland=$(pacman -Q hyprland | cut -d' ' -f2)")
  make -C omarchy-cinema/plugin install DESTDIR="$pkgdir" ENGINE=/usr/lib/omarchy-cinema
  install -Dm 644 omarchy-cinema/LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
