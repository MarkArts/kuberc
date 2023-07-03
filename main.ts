import { parse } from "https://deno.land/std@0.192.0/flags/mod.ts";
import { parseAll } from "https://deno.land/std@0.192.0/yaml/mod.ts";

const parsedArgs = parse(Deno.args);

let k8sConfig = "";
if (parsedArgs.__file) {
  k8sConfig = await Deno.readTextFile(parsedArgs.__file);
} else {
  const decoder = new TextDecoder();
  for await (const chunk of Deno.stdin.readable) {
    k8sConfig += decoder.decode(chunk);
  }
}

const k8sYAML: any = parseAll(k8sConfig);

for (const resource of k8sYAML) {
  if (resource.kind == "HorizontalPodAutoscaler") {
    if (!doesScaleTargetExist(resource.spec.scaleTargetRef, k8sYAML)) {
      console.log(
        `${resource.kind}: ${resource.metadata.name} scaltetargeref does not exist`,
        resource.spec.scaleTargetRef,
      );
    }
  }

  if (resource.kind == "Service") {
    if (!doesServiceSelectorExist(resource.spec.selector, k8sYAML)) {
      console.log(
        `${resource.kind}: ${resource.metadata.name} selector does not exist. selector:\n`,
        resource.spec.selector,
      );
    }
  }

  // For now we only support `matchLabels`
  if (resource.kind == "PodMonitor") {
    if (!doesPodMonitorSelectorExist(resource.spec.selector, k8sYAML)) {
      console.log(
        `${resource.kind}: ${resource.metadata.name} selector does not exist. selector:\n`,
        resource.spec.selector,
      );
    }
  }

  // For now only support rules[].http.paths[].backend.service
  if (resource.kind == "Ingress") {
    for (const rule of resource!.spec!.rules) {
      for (const path of rule!.http!.paths) {
        if (!doesIngressBackendExist(path.backend, k8sYAML)) {
          console.log(
            `${resource.kind}: ${resource.metadata.name}, ${rule.host}, ${path.path} backend does not exist. backend:\n`,
            path.backend,
          );
        }
      }
    }
  }
}

function doesScaleTargetExist(
  scaleTargetRef: { kind: string; apiVersion: string; name: string },
  resources: any,
): boolean {
  for (const resource of resources) {
    if (
      resource?.kind == scaleTargetRef.kind &&
      resource?.apiVersion == scaleTargetRef.apiVersion &&
      resource?.metadata?.name == scaleTargetRef.name
    ) {
      return true;
    }
  }
  return false;
}

function doesServiceSelectorExist(
  selector: { [key: string]: string },
  resources: any,
): boolean {
  for (const resource of resources) {
    if (resource?.spec?.template?.metadata?.labels) {
      if (labelsMatch(selector, resource?.spec?.template?.metadata?.labels)) {
        return true;
      }
    }
  }
  return false;
}

function doesPodMonitorSelectorExist(
  selector: { matchLabels: { [key: string]: string } },
  resources: any,
): boolean {
  for (const resource of resources) {
    if (resource?.spec?.template?.metadata?.labels) {
      if (
        labelsMatch(
          selector.matchLabels,
          resource?.spec?.template?.metadata?.labels,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

// This only supports finding service backends
function doesIngressBackendExist(
  backend: { service: { name: string; port: { name: string } } },
  resources: any,
): boolean {
  /*
    For mock services, for example we have a alb ingress that uses actions (https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.2/guide/ingress/annotations/#actions).
  */
  if (backend.service.port.name == "use-annotation") {
    return true;
  }

  for (const resource of resources) {
    if (
      resource.kind == "Service" &&
      resource.metadata.name == backend.service.name &&
      resource.spec.ports.some((p: { name: string }) =>
        p.name == backend.service.port.name
      )
    ) {
      return true;
    }
  }
  return false;
}

function labelsMatch(
  labelSelector: { [key: string]: string },
  labelSelectorTarget: { [key: string]: string },
): boolean {
  return Object.keys(labelSelector).reduce((acc, key) => {
    if (labelSelector[key] != labelSelectorTarget[key]) {
      return false;
    }
    return acc;
  }, true);
}
