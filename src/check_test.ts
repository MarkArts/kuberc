import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  checkDeploymentOrStateFullSet,
  checkHPA,
  checkIngress,
  checkPodMonitor,
  checkService,
} from "./checks.ts";

const deployment = {
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "euc1-testing-example-flower-deployment",
  },
  "spec": {
    "selector": {
      "matchLabels": {
        "app": "example",
      },
    },
    "template": {
      "metadata": {
        "labels": {
          "app": "example",
        },
      },
      "spec": {
        "containers": [
          {
            "env": [],
            "envFrom": [
              {
                "configMapRef": {
                  "name": "euc1-testing-example-env-2d5b8f6ggb",
                },
              },
            ],
            "image": "mher/flower:1.2",
            "name": "flower",
            "ports": [
              {
                "containerPort": 5555,
                "name": "api",
              },
            ],
          },
        ],
        "volumes": [
          {
            "configMap": {
              "items": [],
              "name": "euc1-testing-example-flower-config",
            },
            "name": "config",
          },
          {
            "name": "flower-storage",
            "persistentVolumeClaim": {
              "claimName": "euc1-testing-example-efs-claim",
            },
          },
        ],
      },
    },
  },
};

const service = {
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: "testService",
  },
  spec: {
    ports: [
      {
        name: deployment.spec.template.spec.containers[0].ports[0].name,
        port: 42,
      },
    ],
    selector: deployment.spec.template.metadata.labels,
  },
};

const ingress = {
  apiVersion: "v1",
  kind: "Ingress",
  metadata: {
    name: "testIngress",
  },
  spec: {
    rules: [
      {
        host: "testhost",
        http: {
          paths: [
            {
              path: "/",
              backend: {
                service: {
                  name: service.metadata.name,
                  port: {
                    name: service.spec.ports[0].name,
                  },
                },
              },
            },
          ],
        },
      },
    ],
  },
};

const podMonitor = {
  apiVersion: "monitoring.coreos.com/v1",
  kind: "PodMonitor",
  metadata: {
    name: "euc1-testing-example-flower-pod-monitor",
  },
  spec: {
    podMetricsEndpoints: [
      {
        path: "/metrics",
        port: deployment.spec.template.spec.containers[0].ports[0].name,
      },
    ],
    selector: {
      matchLabels: deployment.spec.template.metadata.labels,
    },
  },
};

Deno.test("Test pod monitor", async (t) => {
  await t.step(
    "check for Podmonitor existing",
    () => {
      assertEquals(
        checkPodMonitor(podMonitor, [podMonitor, deployment]).length,
        0,
      );
    },
  );

  await t.step("Check for selected resource not existing", () => {
    assertEquals(checkPodMonitor(podMonitor, [podMonitor]).length, 1);
  });

  await t.step("Check for port not existing on selected resource", () => {
    const brokenPodMonitor = { ...podMonitor };
    brokenPodMonitor.spec.podMetricsEndpoints[0].port = "doesnotexist";
    assertEquals(
      checkPodMonitor(podMonitor, [podMonitor, deployment]).length,
      1,
    );
  });
});

Deno.test("Test ingress check", async (t) => {
  await t.step("Check for valid service", () => {
    assertEquals(checkIngress(ingress, [ingress, service]).length, 0);
  });

  await t.step("Check for service not existing", () => {
    assertEquals(checkIngress(ingress, [ingress]).length, 1);
  });

  await t.step(
    "Check for issues when service exist but ingress references 2 ports that don't",
    () => {
      const brokenIngress = { ...ingress };
      ingress.spec.rules[0].http.paths = [
        {
          path: "/",
          backend: {
            service: {
              name: service.metadata.name,
              port: {
                name: "doesnotexist",
              },
            },
          },
        },
        {
          path: "/api",
          backend: {
            service: {
              name: service.metadata.name,
              port: {
                name: "doesalsonotexist",
              },
            },
          },
        },
      ];
      assertEquals(
        checkIngress(brokenIngress, [brokenIngress, service]).length,
        2,
      );
    },
  );
});

Deno.test("Test service check", async (t) => {
  await t.step("Selected resource exists", () => {
    assertEquals(checkService(service, [service, deployment]).length, 0);
  });

  await t.step("Check for selected resource not existing", () => {
    assertEquals(checkService(service, [service]).length, 1);
  });

  await t.step(
    "Check for second port not existing on selected resource",
    () => {
      const brokenService = { ...service };
      brokenService.spec.ports = [
        ...brokenService.spec.ports,
        {
          name: "brokenport",
          port: 24,
        },
      ];
      assertEquals(
        checkService(brokenService, [service, deployment]).length,
        1,
      );
    },
  );
});
