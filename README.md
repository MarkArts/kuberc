# Kube reference checker

Kuberc is a tool that will check if references to other resources exist in a
list of k8s resources. The use case is that if your app bundles a bunch of
resources you can check if you correctly spelled and setup the labels and
selectors. Usually your k8s resource bundles will reference some pre-hosted
resources, for example you might have a secret for dockerconfigjson in the
cluster you are deploying too. kuberc will make some opinionated decisions on
what resources should and shouldn't be bundled.

## Limitations and assumptions

This will not support every possible selector and makes some assumptions to the
resources.

- It will ignore namespaces and assume the whole input is in the same namespace
- podselectors will only check the templates of Deployment and Statefullsets,
  not replicasets, raw pods or otherwise
- Podmonitor only supports matchlabels
- Ingress only supports `rules[].http.paths[].backend.service`

# Setup

Use the nix shell or setup deno yourself. the nix shell will also create a
.vscode config with autocomplete for deno and link vscode to the nix installed
deno

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

![image](https://github.com/MarkArts/kube-reference-checker/assets/5372451/1e9ef4df-cb5e-4579-b9f5-807f81ad4ff1)
