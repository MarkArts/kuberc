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
    if (!doesScaleServiceSelectorExist(resource.spec.selector, k8sYAML)) {
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

function doesScaleServiceSelectorExist(
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
