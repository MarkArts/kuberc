# Kube reference checker

Kuberc is a tool that will check if references to other resources exist in a
list of k8s resources. The use case is that if your app bundles a bunch of
resources you can check if you correctly spelled and setup the labels and
selectors. Usually your k8s resource bundles will reference some pre-hosted
resources, for example you might have a secret for dockerconfigjson in the
cluster you are deploying too. kuberc will make some opinionated decisions on
what resources should and shouldn't be bundled.

# Setup

Use the nix shell or setup deno yourself. This will also create a .vscode config
with autocomplete for deno and link vscode the nix installed deno used in the
shell

```
nix-shell
```

In practice you probaply want to run this in ci or build a kustomize dir and
verify it for example:

```
kubectl kustomize ../myapp/deploy/overlays/euc1-testing/ | deno run main.ts
```

## Example

```
nix-shell
cat broken-example.yaml | deno run main.ts
```
