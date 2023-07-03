export type BaseK8SResource = {
  kind: string;
  apiVersion: string;
  metadata: { name: string };
};

export class ReferenceCheckIssue {
  resource: BaseK8SResource;
  msg: string;
  constructor(resource: BaseK8SResource, msg: string) {
    this.msg = msg;

    this.resource = resource;
  }
}

type ScaleTargetRef = { kind: string; apiVersion: string; name: string };
class ScaleTargetDoesNotExist extends ReferenceCheckIssue {
  scaleTargetRef: ScaleTargetRef;
  constructor(
    resource: BaseK8SResource,
    scaleTargetRef: ScaleTargetRef,
  ) {
    super(
      resource,
      `.spec.scaleTargetRef does not reference a existing deployment or statefullset`,
    );

    this.scaleTargetRef = scaleTargetRef;
  }
}

export function checkHPA(
  hpa: {
    spec: { scaleTargetRef: ScaleTargetRef };
  } & BaseK8SResource,
  resources: BaseK8SResource[],
): ReferenceCheckIssue[] {
  if (!doesScaleTargetExist(hpa.spec.scaleTargetRef, resources)) {
    return [
      new ScaleTargetDoesNotExist(
        hpa,
        hpa.spec.scaleTargetRef,
      ),
    ];
  }
  return [];
}

class PodSelectorDoesNotExist extends ReferenceCheckIssue {
  podSelector: { [key: string]: string };
  constructor(
    resource: BaseK8SResource,
    serviceSelector: { [key: string]: string },
  ) {
    super(resource, ".spec.selector does not select any pods");

    this.podSelector = serviceSelector;
  }
}

export function checkService(
  service: {
    spec: { selector: { [key: string]: string } };
  } & BaseK8SResource,
  resources: BaseK8SResource[],
): ReferenceCheckIssue[] {
  if (!doesServiceSelectorExist(service.spec.selector, resources)) {
    return [
      new PodSelectorDoesNotExist(
        service,
        service.spec.selector,
      ),
    ];
  }

  return [];
}

export function checkPodMonitor(
  podMonitor: {
    spec: { selector: { matchLabels: { [key: string]: string } } };
  } & BaseK8SResource,
  resources: BaseK8SResource[],
) {
  if (!doesPodMonitorSelectorExist(podMonitor.spec.selector, resources)) {
    return [
      new PodSelectorDoesNotExist(
        podMonitor,
        podMonitor.spec.selector.matchLabels,
      ),
    ];
  }

  return [];
}

type ingressBackend = { service: { name: string; port: { name: string } } };
class IngressPathDoesNotExist extends ReferenceCheckIssue {
  path: { backend: ingressBackend; path: string };
  constructor(
    resource: BaseK8SResource,
    path: { backend: ingressBackend; path: string },
  ) {
    super(
      resource,
      `path ${path.path} of ingress.spec.rules[].http.paths[].backend does not reference a existing service`,
    );

    this.path = path;
  }
}

/*
  checkIngress only supports checking the reference http rules referecing a service
*/
export function checkIngress(
  ingress: {
    spec: {
      rules: {
        host: string;
        http: { paths: { backend: ingressBackend; path: string }[] };
      }[];
    };
  } & BaseK8SResource,
  resources: BaseK8SResource[],
): ReferenceCheckIssue[] {
  let issues: ReferenceCheckIssue[] = [];
  for (const rule of ingress.spec.rules) {
    for (const path of rule!.http!.paths) {
      if (!doesIngressBackendExist(path.backend, resources)) {
        issues = [
          ...issues,
          new IngressPathDoesNotExist(ingress, path),
        ];
      }
    }
  }

  return issues;
}

class DeploymentSelectorDoesNotMatchTemplate extends ReferenceCheckIssue {
  selector: { matchLabels: { [key: string]: string } };

  constructor(
    resource: BaseK8SResource,
    selector: { matchLabels: { [key: string]: string } },
  ) {
    super(
      resource,
      ".spec.selector does not match spec.template.metadata.labels",
    );

    this.selector = selector;
  }
}

class VolumeDoesNotExist extends ReferenceCheckIssue {
  volume: { name: string };

  constructor(
    resource: BaseK8SResource,
    volume: { name: string },
  ) {
    super(
      resource,
      `.spec.template.volumes[] (${volume.name}) references a volume that does not exist`,
    );

    this.volume = volume;
  }
}

class ContainerConfigmapRefDoesNotExist extends ReferenceCheckIssue {
  container: any;
  configMapRef: any;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    container: any,
    configMapRef: any,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references configmap (${configMapRef.name}) which doesn't exist`,
    );

    this.container = container;
    this.configMapRef = configMapRef;
    this.configKey = configKey;
  }
}

class ContainerConfigmapKeyDoesNotExist extends ReferenceCheckIssue {
  container: any;
  configMapKeyRef: any;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    container: any,
    configMapKeyRef: any,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references the key (${configMapKeyRef.key}) of configmap (${configMapKeyRef.name}) which doesn't exist`,
    );

    this.container = container;
    this.configMapKeyRef = configMapKeyRef;
    this.configKey = configKey;
  }
}

class ContainerSecretRefDoesNotExist extends ReferenceCheckIssue {
  secretRef: any;
  container: any;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    container: any,
    secretRef: any,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references secret (${secretRef.name}) that does not exist`,
    );

    this.container = container;
    this.secretRef = secretRef;
    this.configKey = configKey;
  }
}

class ContainerSecretKeyDoesNotExist extends ReferenceCheckIssue {
  container: any;
  secretKeyRef: any;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    container: any,
    secretKeyRef: any,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references the key (${secretKeyRef.key}) of secret (${secretKeyRef.name}) which doesn't exist`,
    );

    this.container = container;
    this.secretKeyRef = secretKeyRef;
    this.configKey = configKey;
  }
}

type deploymentOrStatefullSet = {
  spec: {
    selector: { matchLabels: { [key: string]: string } };
    template: {
      metadata: { labels: { [key: string]: string } };
      spec: {
        volumes?: {
          name: string;
          configMap?: { name: string };
          persistentVolumeClaim?: { claimName: string };
        }[];
        containers?: any;
        initContainers?: any;
      };
    };
  };
} & BaseK8SResource;

export function checkDeploymentOrStateFullSet(
  resource: deploymentOrStatefullSet,
  resources: BaseK8SResource[],
  skipConfigmapRefs: string[],
  skipSecretRefs: string[],
): ReferenceCheckIssue[] {
  let issues: ReferenceCheckIssue[] = [];
  // Does not support .spec.selector.matchExpressions
  if (
    !labelsMatch(
      resource.spec.selector.matchLabels,
      resource.spec.template.metadata.labels,
    )
  ) {
    issues = [
      ...issues,
      new DeploymentSelectorDoesNotMatchTemplate(
        resource,
        resource.spec.selector,
      ),
    ];
  }

  if (resource.spec.template.spec.volumes) {
    // Only supports configmap and persistentVolumeClain
    for (const volume of resource.spec.template.spec.volumes) {
      if (volume.configMap) {
        if (!findResource("ConfigMap", volume.configMap.name, resources)) {
          issues = [
            ...issues,
            new VolumeDoesNotExist(resource, volume),
          ];
        }
      }

      if (volume.persistentVolumeClaim) {
        if (
          !findResource(
            "persistentVolumeClaim",
            volume.persistentVolumeClaim.claimName,
            resources,
          )
        ) {
          issues = [
            ...issues,
            new VolumeDoesNotExist(resource, volume),
          ];
        }
      }
    }
  }

  const containers = [
    ...resource.spec.template.spec.containers,
    ...resource.spec.template.spec.initContainers
      ? resource.spec.template.spec.initContainers
      : [],
  ];
  for (const container of containers) {
    if (container.envFrom) {
      for (const envFrom of container.envFrom) {
        if (
          envFrom.configMapRef &&
          !skipConfigmapRefs.includes(envFrom.configMapRef.name) &&
          !envFrom.configMapRef.optional &&
          !findResource(
            "ConfigMap",
            envFrom.configMapRef.name,
            resources,
          )
        ) {
          {
            issues = [
              ...issues,
              new ContainerConfigmapRefDoesNotExist(
                resource,
                container,
                envFrom.configMapRef,
                ".spec.template.spec.containers[].envFrom.configMapRef",
              ),
            ];
          }
        }
        if (
          envFrom.secretRef &&
          !skipSecretRefs.includes(envFrom.secretRef.name) &&
          !envFrom.secretRef.optional &&
          !findResource("Secret", envFrom.secretRef.name, resources)
        ) {
          issues = [
            ...issues,
            new ContainerSecretRefDoesNotExist(
              resource,
              container,
              envFrom.secretRef,
              ".spec.template.spec.containers[].envFrom.secretRef",
            ),
          ];
        }
      }
    }

    // We don't support fieldRef for spec.template.spec.containers[].env[].valueFrom
    if (container.env) {
      for (const env of container.env) {
        if (
          env.valueFrom?.configMapKeyRef &&
          !skipConfigmapRefs.includes(env.valueFrom.configMapKeyRef.name) &&
          !env.valueFrom.configMapKeyRef.optional
        ) {
          // @ts-ignore we know that we will get a configmap
          const configMap: { data: { [key: string]: string } } | undefined =
            findResource(
              "ConfigMap",
              env.valueFrom.configMapKeyRef.name,
              resources,
            );
          if (!configMap) {
            issues = [
              ...issues,
              new ContainerConfigmapRefDoesNotExist(
                resource,
                container,
                env.valueFrom.configMapKeyRef,
                ".spec.template.spec.containers[].env[].configMapKeyRef",
              ),
            ];
          } else {
            if (
              !Object.keys(configMap.data).some((d) =>
                d == env.valueFrom.configMapKeyRef.key
              )
            ) {
              issues = [
                ...issues,
                new ContainerConfigmapKeyDoesNotExist(
                  resource,
                  container,
                  env.valueFrom.configMapKeyRef,
                  ".spec.template.spec.containers[].env[].configMapKeyRef",
                ),
              ];
            }
          }
        }

        if (
          env.valueFrom?.secretKeyRef &&
          !env.valueFrom.secretKeyRef.optional &&
          !skipSecretRefs.includes(env.valueFrom.secretKeyRef.name)
        ) {
          if (
            !isSecretInSopsTemplate(
              env.valueFrom.secretKeyRef.name,
              env.valueFrom.secretKeyRef.key,
              resources,
            )
          ) {
            // @ts-ignore we know we get a secret back
            const secret: { data: string } | undefined = findResource(
              "Secret",
              env.valueFrom.secretKeyRef.name,
              resources,
            );

            if (!secret) {
              issues = [
                ...issues,
                new ContainerSecretRefDoesNotExist(
                  resource,
                  container,
                  env.valueFrom.secretKeyRef,
                  ".spec.template.spec.containers[].env[].secretKeyRef",
                ),
              ];
            } else {
              if (
                !Object.keys(secret.data).some((d) =>
                  d == env.valueFrom.secretKeyRef.key
                )
              ) {
                issues = [
                  ...issues,
                  new ContainerSecretKeyDoesNotExist(
                    resource,
                    container,
                    env.valueFrom.secretKeyRef,
                    ".spec.template.spec.containers[].env[].secretKeyRef",
                  ),
                ];
              }
            }
          }
        }
      }
    }
  }

  return issues;
}

function isSecretInSopsTemplate(
  name: string,
  key: string,
  resources:
    | {
      spec: {
        secretTemplates: {
          name: string;
          stringData?: { [key: string]: string };
          data?: { [key: string]: string };
        }[];
      };
    }[] & BaseK8SResource[]
    | BaseK8SResource[],
): boolean {
  for (const resource of resources) {
    if (resource.kind === "SopsSecret") {
      // @ts-ignore we know the value exists if kind is SopsSecret
      for (const secret of resource.spec.secretTemplates) {
        if (
          secret.name == name &&
          (
            (secret.stringData &&
              Object.keys(secret.stringData).some((k) => k == key)) ||
            (secret.data && Object.keys(secret.data).some((k) => k == key))
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function findResource(
  kind: string,
  name: string,
  resources: BaseK8SResource[],
): BaseK8SResource | null {
  for (const resource of resources) {
    if (
      resource.kind == kind, resource.metadata.name == name
    ) {
      return resource;
    }
  }
  return null;
}

function doesScaleTargetExist(
  scaleTargetRef: ScaleTargetRef,
  resources: BaseK8SResource[],
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

/*
 This will only check if a Deployment or Statefullset will create a replicaSet that will contain
 pods that the service selector can target. This does not check for raw pods or replicaSets
*/
function doesServiceSelectorExist(
  selector: { [key: string]: string },
  resources: {
    spec?: {
      template: {
        metadata: {
          labels: { [key: string]: string };
        };
      };
    };
  }[] & BaseK8SResource[],
): boolean {
  for (const resource of resources) {
    if (resource.spec?.template?.metadata?.labels) {
      if (labelsMatch(selector, resource?.spec?.template?.metadata?.labels)) {
        return true;
      }
    }
  }
  return false;
}

/*
 This will only check if a Deployment or Statefullset will create a replicaSet that will contain
 pods that the podmonitor can target. This does not check for raw pods or replicaSets
*/
function doesPodMonitorSelectorExist(
  selector: { matchLabels: { [key: string]: string } },
  resources: {
    spec?: {
      template: {
        metadata: {
          labels: { [key: string]: string };
        };
      };
    };
  }[] & BaseK8SResource[],
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
  backend: ingressBackend,
  resources:
    | { spec: { ports: { name: string }[] } }[] & BaseK8SResource[]
    | BaseK8SResource[],
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
      // @ts-ignore we know that if `resource.kind=Service` spec.ports will exist
      resource.spec.ports.some((p) => p.name == backend.service.port.name)
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
