type baseK8SResource = {
  kind: string;
  apiVersion: string;
  metadata: { name: string };
};

class ReferenceCheckError extends Error {
  resource: baseK8SResource;

  constructor(resource: baseK8SResource, msg: string) {
    super(msg);

    this.resource = resource;
  }
}

type ScaleTargetRef = { kind: string; apiVersion: string; name: string };
class ScaleTargetDoesNotExist extends ReferenceCheckError {
  scaleTargetRef: ScaleTargetRef;

  constructor(
    resource: baseK8SResource,
    scaleTargetRef: ScaleTargetRef,
    msg: string,
  ) {
    super(resource, msg);

    this.scaleTargetRef = scaleTargetRef;
  }
}

export function checkHPA(
  hpa: {
    spec: { scaleTargetRef: ScaleTargetRef };
  } & baseK8SResource,
  resources: baseK8SResource[],
) {
  if (!doesScaleTargetExist(hpa.spec.scaleTargetRef, resources)) {
    throw new ScaleTargetDoesNotExist(
      hpa,
      hpa.spec.scaleTargetRef,
      "ScaleTargetRef does not exist",
    );
  }
}

export function checkService(
  service: {
    spec: { selector: { [key: string]: string } };
  } & baseK8SResource,
  resources: baseK8SResource[],
) {
  if (!doesServiceSelectorExist(service.spec.selector, resources)) {
    console.log(
      `${service.kind}: ${service.metadata.name} selector does not exist. selector:\n`,
      service.spec.selector,
    );
  }
}

export function checkPodMonitor(
  podMonitor: {
    spec: { selector: { matchLabels: { [key: string]: string } } };
  } & baseK8SResource,
  resources: baseK8SResource[],
) {
  if (!doesPodMonitorSelectorExist(podMonitor.spec.selector, resources)) {
    console.error(
      `${podMonitor.kind}: ${podMonitor.metadata.name} selector does not exist. selector:\n`,
      podMonitor.spec.selector,
    );
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
) {
  for (const rule of ingress.spec.rules) {
    for (const path of rule!.http!.paths) {
      if (!doesIngressBackendExist(path.backend, resources)) {
        console.log(
          `${ingress.kind}: ${ingress.metadata.name}, ${rule.host}, ${path.path} backend does not exist. backend:\n`,
          path.backend,
        );
      }
    }
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
) {
  // Does not support .spec.selector.matchExpressions
  if (
    !labelsMatch(
      resource.spec.selector.matchLabels,
      resource.spec.template.metadata.labels,
    )
  ) {
    console.error(
      `${resource.kind}: ${resource.metadata.name} Deployment spec.selector does not match spec.template.metadata.lables: selector:\n`,
      resource.spec.selector.matchLabels,
      "spec.template.metadata.labels:\n",
      resource.spec.template.metadata.labels,
    );
  }

  if (resource.spec.template.spec.volumes) {
    // Only supports configmap and persistentVolumeClain
    for (const volume of resource.spec.template.spec.volumes) {
      if (volume.configMap) {
        if (!findResource("ConfigMap", volume.configMap.name, resources)) {
          console.error(
            `${resource.kind}: ${resource.metadata.name}, references configmap that does not exist for volume ${volume.name}:\n`,
            volume,
          );
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
          console.error(
            `${resource.kind}: ${resource.metadata.name}, references persistentVolumeClaim that does not exist for volume ${volume.name}:\n`,
            volume,
          );
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
            console.error(
              `${resource.kind}: ${resource.metadata.name}, container ${container.name} (${container.image}) references configmap that does not exist. envFrom[].configMapRef:\n`,
              envFrom.configMapRef,
            );
          }
        }
        if (
          envFrom.secretRef &&
          !skipSecretRefs.includes(envFrom.secretRef.name) &&
          !envFrom.secretRef.optional &&
          !findResource("Secret", envFrom.secretRef.name, resources)
        ) {
          console.error(
            `${resource.kind}: ${resource.metadata.name}, container ${container.name} (${container.image}) references secret that does not exist. envFrom[].secretRef:\n`,
            envFrom.secretRef,
          );
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
            console.error(
              `${resource.kind}: ${resource.metadata.name}, container ${container.name}, ${env.name} references configmap that does not exist. env[].valueFrom.configMapKeyRef:\n`,
              env.valueFrom.configMapKeyRef,
            );
          } else {
            if (
              !Object.keys(configMap.data).some((d) =>
                d == env.valueFrom.configMapKeyRef.key
              )
            ) {
              console.error(
                `${resource.kind}: ${resource.metadata.name}, container ${container.name}, ${env.name} references key in configmap that does not exist. env[].valueFrom.configMapKeyRef:\n`,
                env.valueFrom.configMapKeyRef,
              );
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
              console.error(
                `${resource.kind}: ${resource.metadata.name}, container ${container.name}, ${env.name} references secret that does not exist. env[].valueFrom.secretKeyRef:\n`,
                env.valueFrom.secretKeyRef,
              );
            } else {
              if (
                !Object.keys(secret.data).some((d) =>
                  d == env.valueFrom.secretKeyRef.key
                )
              ) {
                console.error(
                  `${resource.kind}: ${resource.metadata.name}, secret ${container.name}, ${env.name} references key in configmap that does not exist. env[].valueFrom.secretKeyRef:\n`,
                  env.valueFrom.secretKeyRef,
                );
              }
            }
          }
        }
      }
    }
  }
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

type ingressBackend = { service: { name: string; port: { name: string } } };

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
