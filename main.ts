import { parse } from "https://deno.land/std@0.192.0/flags/mod.ts";
import { parseAll } from "https://deno.land/std@0.192.0/yaml/mod.ts";
import {
  BaseK8SResource,
  checkDeploymentOrStateFullSet,
  checkHPA,
  checkIngress,
  checkPodMonitor,
  checkService,
  ReferenceCheckIssue,
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

let issues: ReferenceCheckIssue[] = [];
for (const resource of resources) {
  if (resource.kind == "HorizontalPodAutoscaler") {
    issues = [
      ...issues,
      ...checkHPA(resource, resources),
    ];
  }

  if (resource.kind == "Service") {
    issues = [
      ...issues,
      ...checkService(resource, resources),
    ];
  }

  // For now we only support `matchLabels`
  if (resource.kind == "PodMonitor") {
    issues = [
      ...issues,
      ...checkPodMonitor(resource, resources),
    ];
  }

  // For now only support rules[].http.paths[].backend.service
  if (resource.kind == "Ingress") {
    issues = [
      ...issues,
      ...checkIngress(resource, resources),
    ];
  }

  if (resource.kind == "Deployment" || resource.kind == "StatefulSet") {
    issues = [
      ...issues,
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
  `Parsed ${resources.length} resources and found ${issues.length} issues`,
);

const issuesByResource = issues.reduce<
  {
    [key: string]: { resource: BaseK8SResource; issues: ReferenceCheckIssue[] };
  }
>((acc, x) => {
  if (!acc[x.resource.metadata.name]) {
    acc[x.resource.metadata.name] = {
      resource: x.resource,
      issues: [x],
    };
  } else {
    acc[x.resource.metadata.name] = {
      resource: x.resource,
      issues: [...acc[x.resource.metadata.name].issues, x],
    };
  }
  return acc;
}, {});

for (const [_, resource] of Object.entries(issuesByResource)) {
  console.log(`${resource.resource.kind} ${resource.resource.metadata.name}:`);
  for (const issue of resource.issues) {
    console.log("\t" + issue.msg);
  }
}

if (issues.length >= 1) {
  Deno.exit(1);
}
