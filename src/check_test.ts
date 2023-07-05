import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import {
  checkDeploymentOrStateFullSet,
  checkHPA,
  checkIngress,
  checkPodMonitor,
  checkService,
} from "./checks.ts";

const pvc = {
  "apiVersion": "v1",
  "kind": "PersistentVolumeClaim",
  "metadata": {
    "name": "example-efs-claim",
  },
  "spec": {},
};

const configMap = {
  "apiVersion": "v1",
  "data": {
    "key": "42",
  },
  "kind": "ConfigMap",
  "metadata": {
    "name": "example-cm",
  },
};

const secret = {
  "apiVersion": "v1",
  "data": {
    "key": "42",
  },
  "kind": "Secret",
  "metadata": {
    "name": "example-secret",
  },
};

const deployment = {
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "example-flower-deployment",
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
                  "name": "example-env",
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
              "items": [{
                "key": Object.keys(configMap.data)[0],
                "path": "/",
              }],
              "name": configMap.metadata.name,
            },
            "name": "config",
          },
          {
            "name": "example-pvc-volume",
            "persistentVolumeClaim": {
              "claimName": pvc.metadata.name,
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
    name: "example-pod-monitor",
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

const hpa = {
  "apiVersion": "autoscaling/v2beta2",
  "kind": "HorizontalPodAutoscaler",
  "metadata": {
    "labels": {},
    "name": "example-hpa",
  },
  "spec": {
    "scaleTargetRef": {
      "apiVersion": "apps/v1",
      "kind": "Deployment",
      "name": deployment.metadata.name,
    },
  },
};

Deno.test("Test deployment check", async (t) => {
  const deploymentWithOnlySelfRef = {
    "apiVersion": "apps/v1",
    "kind": "Deployment",
    "metadata": {
      "name": "example-deployment",
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
          "containers": [],
          "volumes": [],
        },
      },
    },
  };

  await t.step("Check if deployment self reference matches", () => {
    assertEquals(
      checkDeploymentOrStateFullSet(deploymentWithOnlySelfRef, []).length,
      0,
    );
  });

  await t.step("Fail deployment check on broken self reference", () => {
    const deploymentWithOnlyBrokenSelfRef = structuredClone(
      deploymentWithOnlySelfRef,
    );
    // @ts-ignore ts complains because it's is an untyped static object
    deploymentWithOnlyBrokenSelfRef.spec.selector.matchLabels["key2"] =
      "missing";
    assertEquals(
      checkDeploymentOrStateFullSet(deploymentWithOnlyBrokenSelfRef, []).length,
      1,
    );
  });

  await t.step("Check deployment pvc volume references", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.volumes = [
      // @ts-ignore ts complains because it's is an untyped static object
      {
        "name": "example-pvc-volume",
        "persistentVolumeClaim": {
          "claimName": pvc.metadata.name,
        },
      },
    ];
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [dp, pvc]).length,
      0,
    );
  });

  await t.step("fail deployment on broken pvc volume references", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.volumes = [
      // @ts-ignore ts complains because it's is an untyped static object
      {
        "name": "example-pvc-volume",
        "persistentVolumeClaim": {
          "claimName": "doesnotexist",
        },
      },
    ];
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [dp, pvc]).length,
      1,
    );
  });

  await t.step("Check deployment configmap volume references", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.volumes = [
      // @ts-ignore ts complains because it's is an untyped static object
      {
        "name": "example-cm-volume",
        "configMap": {
          "items": [{
            "key": Object.keys(configMap.data)[0],
            "path": "/",
          }],
          "name": configMap.metadata.name,
        },
      },
    ];

    assertEquals(
      checkDeploymentOrStateFullSet(dp, [dp, configMap])
        .length,
      0,
    );
  });

  await t.step("Check deployment configmap volume with broken ref", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.volumes = [
      // @ts-ignore ts complains because it's is an untyped static object
      {
        "name": "example-cm-volume",
        "configMap": {
          "items": [{
            "key": Object.keys(configMap.data)[0],
            "path": "/",
          }],
          "name": "thiscmdoesnotexist",
        },
      },
    ];
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [dp, configMap])
        .length,
      1,
    );
  });

  await t.step("Check deployment configmap volume with broken key ref", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.volumes = [
      // @ts-ignore ts complains because it's is an untyped static object
      {
        "name": "example-cm-volume",
        "configMap": {
          "items": [{
            "key": "thiskeydoesnotexist",
            "path": "/",
          }],
          "name": configMap.metadata.name,
        },
      },
    ];
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [dp, configMap])
        .length,
      1,
    );
  });

  await t.step("Check deployment envFrom configmap", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.containers[0] = {
      // @ts-ignore ts complains because it's is an untyped static object
      envFrom: [{
        configMapRef: {
          name: configMap.metadata.name,
        },
      }],
    };
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [
        dp,
        configMap,
      ])
        .length,
      0,
    );
  });

  await t.step("Check deployment with missing envFrom configmap", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.containers[0] = {
      // @ts-ignore ts complains because it's is an untyped static object
      envFrom: [{
        configMapRef: {
          name: "doesNotExist",
        },
      }],
    };
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [
        dp,
        configMap,
      ])
        .length,
      1,
    );
  });

  await t.step(
    "Check deployment with missing envFrom configmap but optional",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        envFrom: [{
          configMapRef: {
            optional: true,
            name: "doesNotExist",
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          configMap,
        ])
          .length,
        0,
      );
    },
  );

  await t.step(
    "Check deployment with a skipped missing envFrom configmap",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        envFrom: [{
          configMapRef: {
            optional: true,
            name: "doesNotExist",
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          configMap,
        ], ["doesNotExist"])
          .length,
        0,
      );
    },
  );

  await t.step("Check deployment envFrom secret", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.containers[0] = {
      // @ts-ignore ts complains because it's is an untyped static object
      envFrom: [{
        secretRef: {
          name: secret.metadata.name,
        },
      }],
    };
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [
        dp,
        secret,
      ])
        .length,
      0,
    );
  });

  await t.step("Check deployment with missing envFrom secretRef", () => {
    const dp = structuredClone(deploymentWithOnlySelfRef);
    dp.spec.template.spec.containers[0] = {
      // @ts-ignore ts complains because it's is an untyped static object
      envFrom: [{
        secretRef: {
          name: "doesNotExist",
        },
      }],
    };
    assertEquals(
      checkDeploymentOrStateFullSet(dp, [
        dp,
        secret,
      ])
        .length,
      1,
    );
  });

  await t.step(
    "Check deployment with missing envFrom secretRef but optional",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        envFrom: [{
          secretRef: {
            optional: true,
            name: "doesNotExist",
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          secret,
        ])
          .length,
        0,
      );
    },
  );

  await t.step(
    "Check deployment with a skipped missing envFrom secretRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        envFrom: [{
          secretRef: {
            optional: true,
            name: "doesNotExist",
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(
          dp,
          [
            dp,
            secret,
          ],
          [],
          ["doesNotExist"],
        )
          .length,
        0,
      );
    },
  );

  await t.step(
    "Check deployment spec.template.spec.containers[].env[].valueFrom.configMapKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            configMapKeyRef: {
              name: configMap.metadata.name,
              key: Object.keys(configMap.data)[0],
            },
          },
        }],
      };

      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          configMap,
        ])
          .length,
        0,
      );
    },
  );

  await t.step(
    "Check deployment with missing spec.template.spec.containers[].env[].valueFrom.configMapKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            configMapKeyRef: {
              name: "does not exist",
              key: Object.keys(configMap.data)[0],
            },
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          configMap,
        ])
          .length,
        1,
      );
    },
  );

  await t.step(
    "Check deployment with missing key spec.template.spec.containers[].env[].valueFrom.configMapKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            configMapKeyRef: {
              name: configMap.metadata.name,
              key: "keydoesnotexist",
            },
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          configMap,
        ])
          .length,
        1,
      );
    },
  );

  await t.step(
    "Check deployment with missing key but optional spec.template.spec.containers[].env[].valueFrom.configMapKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            configMapKeyRef: {
              optional: true,
              name: configMap.metadata.name,
              key: "keydoesnotexist",
            },
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          configMap,
        ])
          .length,
        0,
      );
    },
  );

  await t.step(
    "Check deployment spec.template.spec.containers[].env[].valueFrom.secretKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            secretKeyRef: {
              name: secret.metadata.name,
              key: Object.keys(secret.data)[0],
            },
          },
        }],
      };

      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          secret,
        ])
          .length,
        0,
      );
    },
  );

  await t.step(
    "Check deployment with missing spec.template.spec.containers[].env[].valueFrom.secretKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            secretKeyRef: {
              name: "doesnotexist",
              key: Object.keys(secret.data)[0],
            },
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          secret,
        ])
          .length,
        1,
      );
    },
  );

  await t.step(
    "Check deployment with missing key spec.template.spec.containers[].env[].valueFrom.secretKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            secretKeyRef: {
              name: secret.metadata.name,
              key: "doesnotexist",
            },
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          secret,
        ])
          .length,
        1,
      );
    },
  );

  await t.step(
    "Check deployment with missing key but optional spec.template.spec.containers[].env[].valueFrom.secretKeyRef",
    () => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            secretKeyRef: {
              optional: true,
              name: secret.metadata.name,
              key: "doesnotexist",
            },
          },
        }],
      };
      assertEquals(
        checkDeploymentOrStateFullSet(dp, [
          dp,
          secret,
        ])
          .length,
        0,
      );
    },
  );

  await t.step(
    "Check deployment missing spec.template.spec.containers[].env[].valueFrom but ignored",
    async (t) => {
      const dp = structuredClone(deploymentWithOnlySelfRef);
      dp.spec.template.spec.containers[0] = {
        // @ts-ignore ts complains because it's is an untyped static object
        env: [{
          valueFrom: {
            secretKeyRef: {
              name: secret.metadata.name,
              key: "secretDoesnotexist",
            },
            configMapKeyRef: {
              name: configMap.metadata.name,
              key: "cmDoesnotexist",
            },
          },
        }],
      };

      await t.step("Assert 2 errors without ignore", () => {
        assertEquals(
          checkDeploymentOrStateFullSet(dp, [
            dp,
            secret,
            configMap,
          ]).length,
          2,
        );
      });

      await t.step("Assert 0 errors with ignore", () => {
        assertEquals(
          checkDeploymentOrStateFullSet(
            dp,
            [
              dp,
              secret,
              configMap,
            ],
            [configMap.metadata.name],
            [secret.metadata.name],
          ).length,
          0,
        );
      });
    },
  );
});

Deno.test("Test hpa check", async (t) => {
  await t.step("check for hpa reference existing", () => {
    assertEquals(checkHPA(hpa, [hpa, deployment]).length, 0);
  });
  await t.step("check for hpa reference not existing", () => {
    assertEquals(checkHPA(hpa, [hpa]).length, 1);
  });
});

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
    const brokenPodMonitor = structuredClone(podMonitor);
    brokenPodMonitor.spec.podMetricsEndpoints[0].port = "doesnotexist";
    assertEquals(
      checkPodMonitor(brokenPodMonitor, [brokenPodMonitor, deployment]).length,
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
      const brokenIngress = structuredClone(ingress);
      brokenIngress.spec.rules[0].http.paths = [
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
      const brokenService = structuredClone(service);
      brokenService.spec.ports = [
        ...brokenService.spec.ports,
        {
          name: "brokenport",
          port: 24,
        },
      ];
      assertEquals(
        checkService(brokenService, [brokenService, deployment]).length,
        1,
      );
    },
  );
});
