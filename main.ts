import { parse } from "https://deno.land/std@0.192.0/flags/mod.ts";
import { parseAll } from "https://deno.land/std@0.192.0/yaml/mod.ts";
import {
  checkDeploymentOrStateFullSet,
  checkHPA,
  checkIngress,
  checkPodMonitor,
  checkService,
  ReferenceCheckError,
} from "./src/checks.ts";

const parsedArgs = parse(Deno.args);
let k8sConfig = "";
if (parsedArgs.file) {
  k8sConfig = await Deno.readTextFile(parsedArgs.__file);
} else {
  const decoder = new TextDecoder();
  for await (const chunk of Deno.stdin.readable) {
    k8sConfig += decoder.decode(chunk);
  }
}

const skipSecretRefs: string[] = parsedArgs.skip_secrets
  ? parsedArgs.skip_secrets.split(",")
  : [];

const skipConfigmapRefs: string[] = parsedArgs.skip_secrets
  ? parsedArgs.skip_secrets.split(",")
  : [];

const resources: any = parseAll(k8sConfig);

let errors: ReferenceCheckError[] = [];
for (const resource of resources) {
  if (resource.kind == "HorizontalPodAutoscaler") {
    errors = [
      ...errors,
      ...checkHPA(resource, resources),
    ];
  }

  if (resource.kind == "Service") {
    errors = [
      ...errors,
      ...checkService(resource, resources),
    ];
  }

  // For now we only support `matchLabels`
  if (resource.kind == "PodMonitor") {
    errors = [
      ...errors,
      ...checkPodMonitor(resource, resources),
    ];
  }

  // For now only support rules[].http.paths[].backend.service
  if (resource.kind == "Ingress") {
    errors = [
      ...errors,
      ...checkIngress(resource, resources),
    ];
  }

  if (resource.kind == "Deployment" || resource.kind == "StatefulSet") {
    errors = [
      ...errors,
      ...checkDeploymentOrStateFullSet(
        resource,
        resources,
        skipConfigmapRefs,
        skipSecretRefs,
      ),
    ];
  }
}

console.log(
  `Parsed ${resources.length} resources and found ${errors.length} issues`,
);
