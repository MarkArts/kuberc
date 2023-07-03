type baseK8SResource = {
  kind: string;
  apiVersion: string;
  metadata: { name: string };
};

export class ReferenceCheckIssue {
  resource: baseK8SResource;
  msg: string;
  constructor(resource: baseK8SResource, msg: string) {
    this.msg = msg;

    this.resource = resource;
  }
}

type ScaleTargetRef = { kind: string; apiVersion: string; name: string };
class ScaleTargetDoesNotExist extends ReferenceCheckIssue {
  scaleTargetRef: ScaleTargetRef;
  constructor(
    resource: baseK8SResource,
    scaleTargetRef: ScaleTargetRef,
  ) {
    super(resource, "ScaleTargetRef does not exist");

    this.scaleTargetRef = scaleTargetRef;
  }
}

export function checkHPA(
  hpa: {
    spec: { scaleTargetRef: ScaleTargetRef };
  } & baseK8SResource,
  resources: baseK8SResource[],
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
    resource: baseK8SResource,
    serviceSelector: { [key: string]: string },
  ) {
    super(resource, "selected pods do not exist");

    this.podSelector = serviceSelector;
  }
}

export function checkService(
  service: {
    spec: { selector: { [key: string]: string } };
  } & baseK8SResource,
  resources: baseK8SResource[],
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
  } & baseK8SResource,
  resources: baseK8SResource[],
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
    resource: baseK8SResource,
    path: { backend: ingressBackend; path: string },
  ) {
    super(resource, "selected pods do not exist");

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
  } & baseK8SResource,
  resources: baseK8SResource[],
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
    resource: baseK8SResource,
    selector: { matchLabels: { [key: string]: string } },
  ) {
    super(
      resource,
      "spec.selector does not match spec.template.metadata.labels",
    );

    this.selector = selector;
  }
}

class VolumeDoesNotExist extends ReferenceCheckIssue {
  volume: { name: string };

  constructor(
    resource: baseK8SResource,
    volume: { name: string },
  ) {
    super(
      resource,
      "spec.template.volumes references volume that does not exist",
    );

    this.volume = volume;
  }
}

class ContainerConfigmapRefDoesNotExist extends ReferenceCheckIssue {
  container: any;
  configMapRef: any;

  constructor(
    resource: baseK8SResource,
    container: any,
    configMapRef: any,
  ) {
    super(
      resource,
      "container references configmap that does not exist",
    );

    this.container = container;
    this.configMapRef = configMapRef;
  }
}

class ContainerConfigmapKeyDoesNotExist extends ReferenceCheckIssue {
  container: any;
  configMapKeyRef: any;

  constructor(
    resource: baseK8SResource,
    container: any,
    configMapKeyRef: any,
  ) {
    super(
      resource,
      "container references a key that does not exist in the configmap",
    );

    this.container = container;
    this.configMapKeyRef = configMapKeyRef;
  }
}

class ContainerSecretRefDoesNotExist extends ReferenceCheckIssue {
  secretRef: any;
  container: any;

  constructor(
    resource: baseK8SResource,
    container: any,
    secretRef: any,
  ) {
    super(
      resource,
      "container references secret that does not exist",
    );

    this.container = container;
    this.secretRef = secretRef;
  }
}

class ContainerSecretKeyDoesNotExist extends ReferenceCheckIssue {
  container: any;
  secretKeyRef: any;

  constructor(
    resource: baseK8SResource,
    container: any,
    secretKeyRef: any,
  ) {
    super(
      resource,
      "container references key that does not exist in the secret",
    );

    this.container = container;
    this.secretKeyRef = secretKeyRef;
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
} & baseK8SResource;

export function checkDeploymentOrStateFullSet(
  resource: deploymentOrStatefullSet,
  resources: baseK8SResource[],
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
    }[] & baseK8SResource[]
    | baseK8SResource[],
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
  resources: baseK8SResource[],
): baseK8SResource | null {
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
  resources: baseK8SResource[],
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
  }[] & baseK8SResource[],
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
  }[] & baseK8SResource[],
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
    | { spec: { ports: { name: string }[] } }[] & baseK8SResource[]
    | baseK8SResource[],
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
