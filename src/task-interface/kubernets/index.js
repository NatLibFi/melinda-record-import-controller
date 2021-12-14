/* eslint-disable */
import {KubeConfig, CoreV1Api, AppsV1Api} from '@kubernetes/client-node';

/*
  KUBERNETS_SUPPORTED_API_VERSIONS,
  AMQP_URL, API_URL, DEBUG,
  API_USERNAME_TRANSFORMER, API_PASSWORD_TRANSFORMER,
  API_USERNAME_IMPORTER, API_PASSWORD_IMPORTER
*/
export default async (KUBERNETS_URL, KUBERNETS_USER, KUBERNETS_PASSWORD, KUBERNETS_CLUSTER_NAME) => {

  const cluster = {
    name: KUBERNETS_CLUSTER_NAME,
    server: KUBERNETS_URL
  };

  const user = {
    name: KUBERNETS_USER,
    password: KUBERNETS_PASSWORD
  };

  const context = {
    name: 'my-context',
    user: user.name,
    cluster: cluster.name
  };

  const kc = new KubeConfig();
  kc.loadFromOptions({
    clusters: [cluster],
    users: [user],
    contexts: [context],
    currentContext: context.name
  });

  const k8sApiCore = kc.makeApiClient(CoreV1Api);
  const k8sApiApps = kc.makeApiClient(AppsV1Api);
  try {
    if (0) {
      await k8sApiCore.readNodeStatus();
    }else {
      await k8sApiApps.listDeploymentForAllNamespaces();
    }

    /*
    const {response} = await k8sApi.listNode();
    const {code, message, details} = response;
    console.log(code);
    console.log(message);
    console.log(JSON.stringify(details));
    */
    /*k8sApi.listNamespacedPod('').then((res) => {
      console.log(res.body);
    });*/
  } catch (error) {
    console.error('******************************** error ****************************************');
    
    if (error.response) {
      const {code, message, reason} = error.response.body;
      console.error(`Status: ${code}`);
      console.error(`Reason: ${reason}`);
      console.error(`Message: ${message}`);
      return;
    }

    console.log(JSON.stringify(error));
  }
};
