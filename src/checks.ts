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

class portDoesNotExistOnResource extends ReferenceCheckIssue {
  portName: string;
  selectedResource: BaseK8SResource;

  constructor(
    resource: BaseK8SResource,
    portName: string,
    selectedResource: BaseK8SResource,
  ) {
    super(
      resource,
      `port ${portName} not found on resource selected with .spec.selector (${selectedResource.kind} ${selectedResource.metadata.name})`,
    );

    this.portName = portName;
    this.selectedResource = selectedResource;
  }
}

export function checkService(
  service: {
    spec: {
      ports: {
        name: string;
        port: number;
      }[];
      selector: { [key: string]: string };
    };
  } & BaseK8SResource,
  resources: BaseK8SResource[],
): ReferenceCheckIssue[] {
  let issues: ReferenceCheckIssue[] = [];
  // @ts-ignore we know we will get either a deployment ot sts back
  const resource:
    | {
      spec: {
        template: {
          spec: {
            containers: {
              ports: {
                containerPort: string;
                name: string;
              }[];
            }[];
          };
        };
      };
    } & BaseK8SResource
    | null = findResourceWithLabels(
      service.spec.selector,
      resources,
    );
  if (!resource) {
    issues = [
      ...issues,
      new PodSelectorDoesNotExist(
        service,
        service.spec.selector,
      ),
    ];
  } else {
    for (const port of service.spec.ports) {
      if (
        !resource.spec.template.spec.containers.some((c) => {
          return c.ports?.some((p) => p.name == port.name);
        })
      ) {
        issues = [
          ...issues,
          new portDoesNotExistOnResource(
            service,
            port.name,
            resource,
          ),
        ];
      }
    }
  }

  return issues;
}

export function checkPodMonitor(
  podMonitor: {
    spec: {
      selector: { matchLabels: { [key: string]: string } };
      podMetricsEndpoints: { path: string; port: string }[];
    };
  } & BaseK8SResource,
  resources: BaseK8SResource[],
): ReferenceCheckIssue[] {
  let issues: ReferenceCheckIssue[] = [];
  // @ts-ignore we know we will get either a deployment ot sts back
  const resource:
    | {
      spec: {
        template: {
          spec: {
            containers: {
              ports: {
                containerPort: string;
                name: string;
              }[];
            }[];
          };
        };
      };
    } & BaseK8SResource
    | null = findResourceWithLabels(
      podMonitor.spec.selector.matchLabels,
      resources,
    );
  if (!resource) {
    issues = [
      ...issues,
      new PodSelectorDoesNotExist(
        podMonitor,
        podMonitor.spec.selector.matchLabels,
      ),
    ];
  } else {
    for (const podMetricsEndpoint of podMonitor.spec.podMetricsEndpoints) {
      if (
        !resource.spec.template.spec.containers.some((c) => {
          return c.ports?.some((p) => p.name == podMetricsEndpoint.port);
        })
      ) {
        issues = [
          ...issues,
          new portDoesNotExistOnResource(
            podMonitor,
            podMetricsEndpoint.port,
            resource,
          ),
        ];
      }
    }
  }

  return issues;
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
      `path ${path.path} of ingress.spec.rules[].http.paths[].backend references service (${path.backend.service.name}) which does not exist`,
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
  skipServices: string[] = [],
): ReferenceCheckIssue[] {
  let issues: ReferenceCheckIssue[] = [];
  for (const rule of ingress.spec.rules) {
    for (const path of rule!.http!.paths) {
      if (
        !skipServices.includes(path.backend.service.name) &&
        !doesIngressBackendExist(path.backend, resources)
      ) {
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

class ConfigmapRefDoesNotExist extends ReferenceCheckIssue {
  configMapName: string;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    configMapName: string,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references configmap (${configMapName}) which doesn't exist`,
    );

    this.configMapName = configMapName;
    this.configKey = configKey;
  }
}

class ConfigmapKeyDoesNotExist extends ReferenceCheckIssue {
  configMapName: string;
  configMapKey: string;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    configMapName: string,
    configMapKey: string,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references key (${configMapKey}) of configmap (${configMapName}) which doesn't exist`,
    );

    this.configMapName = configMapName;
    this.configMapKey = configMapKey;
    this.configKey = configKey;
  }
}

class SecretRefDoesNotExist extends ReferenceCheckIssue {
  secretName: string;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    secretName: string,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references secret (${secretName}) which doesn't exist`,
    );

    this.secretName = secretName;
    this.configKey = configKey;
  }
}

class SecretKeyDoesNotExist extends ReferenceCheckIssue {
  secretName: string;
  secretKey: string;
  configKey: string;

  constructor(
    resource: BaseK8SResource,
    secretName: string,
    secretKey: string,
    configKey: string,
  ) {
    super(
      resource,
      `${configKey} references key (${secretKey}) of secret (${secretName}) which doesn't exist`,
    );

    this.secretName = secretName;
    this.secretKey = secretKey;
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
          configMap?: { name: string; items: { key: string; path: string }[] };
          persistentVolumeClaim?: { claimName: string };
        }[];
        // To lazy to typeout the whole container definition
        // deno-lint-ignore no-explicit-any
        containers?: any;
        // To lazy to typeout the whole container definition
        // deno-lint-ignore no-explicit-any
        initContainers?: any;
      };
    };
  };
} & BaseK8SResource;

export function checkDeploymentOrStateFullSet(
  resource: deploymentOrStatefullSet,
  resources: BaseK8SResource[],
  skipConfigmapRefs: string[] = [],
  skipSecretRefs: string[] = [],
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
    for (const volume of resource.spec.template.spec.volumes) {
      if (volume.configMap) {
        if (!findResource("ConfigMap", volume.configMap.name, resources)) {
          issues = [
            ...issues,
            new VolumeDoesNotExist(resource, volume),
          ];
        } else {
          // @ts-ignore we know that we will get a configmap
          const configMap: { data: { [key: string]: string } } | null =
            findResource("ConfigMap", volume.configMap.name, resources);
          if (!configMap) {
            issues = [
              ...issues,
              new VolumeDoesNotExist(resource, volume),
            ];
          } else {
            for (const item of volume.configMap.items) {
              if (
                !Object.keys(configMap.data).some((k) => k == item.key)
              ) {
                issues = [
                  ...issues,
                  new ConfigmapKeyDoesNotExist(
                    resource,
                    volume.configMap.name,
                    item.key,
                    ".spec.template.spec.volumes[].configmap.items[].key",
                  ),
                ];
              }
            }
          }
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
              new ConfigmapRefDoesNotExist(
                resource,
                envFrom.configMapRef,
                ".spec.template.spec.containers|initContainers[].envFrom.configMapRef",
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
            new SecretRefDoesNotExist(
              resource,
              envFrom.secretRef.name,
              ".spec.template.spec.containers|initContainers[].envFrom.secretRef",
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
          const configMap: { data: { [key: string]: string } } | null =
            findResource(
              "ConfigMap",
              env.valueFrom.configMapKeyRef.name,
              resources,
            );
          if (!configMap) {
            issues = [
              ...issues,
              new ConfigmapRefDoesNotExist(
                resource,
                env.valueFrom.configMapKeyRef.name,
                ".spec.template.spec.containers|initContainers[].env[].configMapKeyRef",
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
                new ConfigmapKeyDoesNotExist(
                  resource,
                  env.valueFrom.configMapKeyRef.name,
                  env.valueFrom.configMapKeyRef.key,
                  ".spec.template.spec.containers|initContainers[].env[].configMapKeyRef",
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
            const secret: { data: string } | null = findResource(
              "Secret",
              env.valueFrom.secretKeyRef.name,
              resources,
            );

            if (!secret) {
              issues = [
                ...issues,
                new SecretRefDoesNotExist(
                  resource,
                  env.valueFrom.secretKeyRef.name,
                  ".spec.template.spec.containers|initContainers[].env[].secretKeyRef",
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
                  new SecretKeyDoesNotExist(
                    resource,
                    env.valueFrom.secretKeyRef.name,
                    env.valueFrom.secretKeyRef.key,
                    ".spec.template.spec.containers|initContainers[].env[].secretKeyRef",
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
 pods that will match the labels. This does not check for raw pods or replicaSets
*/
function findResourceWithLabels(
  labels: { [key: string]: string },
  resources: {
    spec?: {
      template: {
        metadata: {
          labels: { [key: string]: string };
        };
      };
    };
  }[] & BaseK8SResource[],
): BaseK8SResource | null {
  for (const resource of resources) {
    if (resource?.spec?.template?.metadata?.labels) {
      if (
        labelsMatch(
          labels,
          resource?.spec?.template?.metadata?.labels,
        )
      ) {
        return resource;
      }
    }
  }
  return null;
}

// This only supports finding service backends and
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
