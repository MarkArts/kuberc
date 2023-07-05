let
    unstable = import (fetchTarball https://nixos.org/channels/nixpkgs-unstable/nixexprs.tar.xz) { };
in
{ pkgs ? import <nixpkgs> {} }:
  pkgs.mkShell {
    # nativeBuildInputs is usually what you want -- tools you need to run
    nativeBuildInputs = [
        unstable.deno
        unstable.jq
    ];

    shellHook = ''
        echo "
            Updating .vscode to point to use nix deno $(which deno)
            and setup formatting on save
        "
        mkdir -p .vscode
        [ -s .vscode/settings.json ] || echo {} > .vscode/settings.json
        echo "$(jq ".\"deno.path\" |= \"$(which deno)\"" .vscode/settings.json)" > .vscode/settings.json
        echo "$(jq ".\"deno.enable\" |= true" .vscode/settings.json)" > .vscode/settings.json
        echo "$(jq ".\"deno.lint\" |= true" .vscode/settings.json)" > .vscode/settings.json
        echo "$(jq ".\"editor.defaultFormatter\" |= \"denoland.vscode-deno\"" .vscode/settings.json)" > .vscode/settings.json
        echo "$(jq ".\"editor.formatOnSave\" |= true" .vscode/settings.json)" > .vscode/settings.json
    '';
}
