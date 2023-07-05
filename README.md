# kuberc

```
deno run https://deno.land/x/kuberc@v4/main.ts --help
```

Kuberc (kube reference checker) is a tool that will check if references to other
resources exist in a list of k8s resources. The use case is that if your app
bundles a bunch of resources you can check if you correctly spelled and setup
the labels, selectors and names of referenced resources. As of writing this
kuberc only supports a subset of k8s resources and their references and makes
some assumptions like dockerconfigjson not being bundled in your apps but
existing on the cluster you are deploying too

## Limitations and assumptions

This will not support every possible selector and makes some assumptions to the
resources.

- It will ignore namespaces and assume the whole input is in the same namespace
- podselectors (for example hpa targets) will only check the templates of
  Deployment and Statefullsets, not replicasets, raw pods or otherwise
- Podmonitor only supports matchlabels
- Ingress only supports `rules[].http.paths[].backend.service`

Current CRDS that are support are:

- SopsSecret (isindir.github.com/v1alpha3)
- PodMonitor (monitoring.coreos.com/v1)

## Arguments

| Flag              | Example                                                       | Description                                                  |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| --skip-secrets    | deno run main.ts --skip-secrets newrelic-license,s3-bucket    | Ignore references to secrets in the given list               |
| --skip-configmaps | deno run main.ts --skip-configmaps newrelic-license,s3-bucket | Ignore references to configmaps in the given list            |
| --skip-services   | deno run main.ts --skip-services external-ingress-service     | Ignore references to services in the given list              |
| --verbose         | deno run main.ts --verbose                                    | Output the issues in json format instead of the readable msg |
| --file            | deno run main.ts --file myk8sconfig.yml                       | Read from a file instead of the STDIN                        |

# Github CI/Action

```yml
on:
  - push

jobs:
  kuberc:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v3
      - uses: MarkArts/kuberc/.github/workflows/kuberc.yml@v4
        with:
          file: ./examples/working-example.yml
```

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
cat examples/broken-example.yml | deno run main.ts
```

![image](https://github.com/MarkArts/kube-reference-checker/assets/5372451/1e9ef4df-cb5e-4579-b9f5-807f81ad4ff1)
