import { ExtensionContext } from "vscode";
import fetch, { RequestInfo, RequestInit, Response } from "node-fetch";

type statusCallback = (status: string, err?: boolean) => void;
export type contractClassification = { layer: string; verb: string; subject: string; variation: string; platform: string };
export type protocolClassification = { layer: string; subject: string; variation: string; platform: string };
type contractTerm = { name: string; type: string; protocol: string; hint: string; length: number; minimum: number; maximum: number };

const fetchUrlSuffix = "/fetch/";
const valleyUrlSuffix = "/valley/view/";
const GLOBALSTATE_CONTRACTS_LABEL = "contracts";
const GLOBALSTATE_PROTOCOLS_LABEL = "protocols";

let csFetchActive = 0;
let csFetchSuccess = 0;
let csFetchFailure = 0;
const concurrentFetchLimit = 20;
const csFetchQueue: ContractSpecification[] = [];

export class Valley {
  context: ExtensionContext;
  apiRootUrl: string;
  contracts: Contracts;
  protocols: Protocols;
  statusCallback: statusCallback;

  constructor() {
    this.context;
    this.apiRootUrl = "";
    this.contracts = new Contracts();
    this.protocols = new Protocols();
    this.statusCallback;
  }
  init(context: ExtensionContext) {
    try {
      this.contracts.init(context);
      this.protocols.init(context);
      this.contracts.resetContext(); // debug
      this.protocols.resetContext(); // debug
      this.contracts.restoreContext();
      this.protocols.restoreContext();
      // TODO return proper status
      return `$(pass) c:${this.contracts.count}, p:${this.protocols.count}]`;
    } catch (error) {
      return `$(debug-disconnect) ${error.message}]`;
    }
  }

  setApiRootUrl(hostname: string, port: number, allowInsecure = false) {
    this.apiRootUrl = (allowInsecure == true ? "http://" : "https://") + hostname + ":" + port;
  }
  get rootDocUrl() {
    return this.apiRootUrl + fetchUrlSuffix + "/";
  }

  async updateSpecifications() {
    // const updateStart = Date.now();
    //clearInterval(timer);
    try {
      const rootDoc = await this.fetchRootDoc(this.rootDocUrl);
      this.contracts.updateFromRootDoc(rootDoc.rootContracts);
      this.protocols.updateFromRootDoc(rootDoc.rootProtocols);
      return `$(pass) c:${this.contracts.count}, p:${this.protocols.count}]`;
    } catch (error) {
      return `$(debug-disconnect) ${error.message}]`;
    }
  }

  async fetchRootDoc(
    rootDocUrl: string
  ): Promise<{ rootContracts: Array<contractClassification>; rootProtocols: Array<protocolClassification> }> {
    return fetchApiJson(rootDocUrl).then((rawSpecs) => {
      if (!rawSpecs || rawSpecs.length === 0) {
        throw new Error("No specifications found. Maintaining specification cache.");
      }
      // Process response into contract and protocol specifications
      // Update specs already in cache
      const rootContracts: contractClassification[] = [];
      const rootProtocols: protocolClassification[] = [];
      for (const spec in rawSpecs) {
        if (isContractName(spec)) {
          rootContracts.push(classifyContractName(spec));
        } else if (isProtocolName(spec)) {
          rootProtocols.push(classifyProtocolName(spec));
        } else {
          console.debug("Failed to decode classification. Must have 3 or '/' characters. : ", spec);
        }
      }
      console.debug(
        "Fetched Valley contains",
        rootContracts.length,
        "contract specifications and",
        rootProtocols.length,
        "protocol specifications."
      );
      return { rootContracts: rootContracts, rootProtocols: rootProtocols };
    });
  }

  // contractUrl(spec:ContractSpecification) {
  //   return this.apiRootUrl + valleyUrlSuffix + encodeURIComponent(spec.classification);
  // }
  contractUrlByClassificationName(name: string) {
    return this.apiRootUrl + valleyUrlSuffix + encodeURIComponent(name);
  }
  protocolUrlByClassificationName(name: string) {
    return this.apiRootUrl + valleyUrlSuffix + encodeURIComponent(name);
  }

  async fetchContractSpec(c: contractClassification) {
    const url = this.apiRootUrl + fetchUrlSuffix + "/" + c.layer + "/" + c.verb + "/" + c.subject + "/" + c.variation + "/" + c.platform;

    const contractSpec = await fetchApiJson(url);
    // console.log('CS:', contractSpec);
    return contractSpec;
  }

  async fetchContractRoutes(fqsn: string) {
    const url = this.apiRootUrl + fetchUrlSuffix + "/" + fqsn;

    const contractSuppliers = await fetchApiText(url);
    // console.log('Sups:', contractSuppliers);
    return contractSuppliers;
  }
  async updateContractSpec(cs: ContractSpecification) {
    if (csFetchActive < concurrentFetchLimit) {
      csFetchActive++;
      let fetchSuccess = false;

      console.debug("Fetching specification:", cs.classification);
      const s = await fetchApiJson(this.apiRootUrl + fetchUrlSuffix + cs.classification);
      if (s) {
        // console.debug('Updating cached specification with:', s);
        this.contracts.addContractByName(s.name, s.description, s.requirments, s.obligations, s.suppliers, true);
        fetchSuccess = true;
      } else {
        console.debug("Failed to update specification", cs.classification);
      }
      if (fetchSuccess) {
        csFetchSuccess++;
      } else {
        csFetchFailure++;
      }
      csFetchActive--;

      // If we have queued fetch requests, process the next one
      if (csFetchQueue && csFetchQueue.length > 0) {
        const nextCs: ContractSpecification = csFetchQueue.pop();
        if (nextCs) {
          this.updateContractSpec(nextCs);
        }
      }

      if (csFetchActive == 0) {
        console.debug(`Fetch total: ${csFetchSuccess + csFetchFailure}, success: ${csFetchSuccess}, failure: ${csFetchFailure}`);
        csFetchSuccess = 0;
        csFetchFailure = 0;
      }
    } else {
      // Call this function again later.
      csFetchQueue.push(cs);
    }
  }
}

export class ContractTerm {
  name: string;
  type: string;
  protocol: string;
  hint: string;
  length: number;
  minimum: number;
  maximum: number;

  constructor(name: string, type: string, protocol = "", hint = "", length = 0, minimum = 0, maximum = 0) {
    this.name = name;
    this.protocol = protocol;
    this.hint = hint;
    this.type = type;
    this.length = length;
    this.minimum = minimum;
    this.maximum = maximum;
  }
  toJSON(): object {
    let c = {};
    switch (this.type) {
      case "abstraction":
        c = { type: this.type, name: this.name, protocol: this.protocol };
        break;
      case "site":
      case "boolean":
        c = { type: this.type, name: this.name };
        break;
      case "integer":
        c = { type: this.type, name: this.name, minimum: this.minimum, maximum: this.maximum, hint: this.hint };
        break;
      case "string":
        c = { type: this.type, name: this.name, length: this.length, hint: this.hint };
        break;
      default:
        break;
    }
    return c;
  }
}

export class ContractSpecification {
  #layer: string;
  #verb: string;
  #subject: string;
  #variation: string;
  #platform: string;
  #suppliers: Array<string>;
  #description: string;
  #reqs: Array<ContractTerm>;
  #oblgs: Array<ContractTerm>;
  #lastModified: number;

  constructor(
    layer: string,
    verb: string,
    subject: string,
    variation: string,
    platform: string,
    description = "",
    reqs: Array<ContractTerm> = [],
    oblgs: Array<ContractTerm> = [],
    suppliers: Array<string> = []
  ) {
    this.#layer = layer;
    this.#verb = verb;
    this.#subject = subject;
    this.#variation = variation;
    this.#platform = platform;
    this.#description = description;
    this.#reqs = reqs;
    this.#oblgs = oblgs;
    this.#suppliers = suppliers;
    this.updateModifyTime();
  }

  valid(): boolean {
    return (
      this.#layer &&
      this.#layer != "" &&
      this.#subject &&
      this.#subject != "" &&
      this.#verb &&
      this.#verb != "" &&
      this.#variation &&
      this.#variation != "" &&
      this.#platform &&
      this.#platform != ""
    );
  }

  get layer(): string {
    return this.#layer;
  }
  get verb(): string {
    return this.#verb;
  }
  get subject(): string {
    return this.#subject;
  }
  get variation(): string {
    return this.#variation;
  }
  get platform(): string {
    return this.#platform;
  }
  get description(): string {
    return this.#description;
  }
  set description(description: string) {
    this.#description = description;
    this.updateModifyTime();
  }
  get requirements(): ContractTerm[] {
    return this.#reqs;
  }
  set requirements(requirements: Array<ContractTerm>) {
    this.#reqs = requirements;
    this.updateModifyTime();
  }
  get obligations(): ContractTerm[] {
    return this.#oblgs;
  }
  set obligations(obligations: Array<ContractTerm>) {
    this.#oblgs = obligations;
    this.updateModifyTime();
  }
  get lastModified(): number {
    return this.#lastModified;
  }
  get suppliers(): string[] {
    return this.#suppliers;
  }
  set suppliers(suppliers: string[]) {
    this.#suppliers = suppliers;
    this.updateModifyTime();
  }
  addSupplier(supplier: string) {
    if (!this.#suppliers.includes(supplier)) {
      this.#suppliers.push(supplier);
      this.updateModifyTime();
    }
  }
  removeSupplier(supplier: string) {
    this.#suppliers = this.suppliers.filter((s) => {
      this.updateModifyTime();
      return s != supplier;
    });
  }
  clearSuppliers() {
    this.#suppliers = [];
    this.updateModifyTime();
  }
  private updateModifyTime() {
    this.#lastModified = Date.now();
  }
  get classification(): string {
    return "/" + this.#layer + "/" + this.#verb + "/" + this.#subject + "/" + this.#variation + "/" + this.#platform;
  }

  toJSON() {
    return {
      type: "supplier",
      name: this.classification,
      description: this.description,
      requirements: this.requirements,
      obligations: this.obligations,
    };
  }
}

export class Contracts {
  context: ExtensionContext;
  #contracts: Array<ContractSpecification>;
  apiRootUrl: string;

  constructor() {
    this.context;
    this.#contracts = [];
    this.apiRootUrl = "";
  }
  init(context: ExtensionContext) {
    this.context = context;
  }

  async saveContext() {
    await this.context.globalState.update(GLOBALSTATE_CONTRACTS_LABEL, this);
    console.debug("Valley cache updated with", this.count, "contracts.");
  }

  restoreContext() {
    const cArray = this.context.globalState.get(GLOBALSTATE_CONTRACTS_LABEL, []);
    console.debug("R:", cArray);

    if (cArray) {
      cArray.forEach((c) => {
        if (isContractName(c.name)) {
          const cs = parseContractSpec(c);
          // console.debug("S:", cs);
          if (cs.valid()) {
            if (!this.exists(cs)) {
              this.#contracts.push(cs);
            } else {
              console.debug("Not restoring duplicate contract specification:", cs.classification);
            }
          } else {
            console.debug("Not restoring invalid contract specification:", cs.classification);
          }
        }
      });
      console.debug(this.#contracts.length, "contract specifications restored from context.");
      console.debug("Valley restored from cache with", this.count, "contracts.");
    } else {
      console.debug("Valley initialised with zero contracts.");
    }
  }
  resetContext() {
    this.context.globalState.update(GLOBALSTATE_CONTRACTS_LABEL, null);
  }

  exists(testSpec: ContractSpecification, matchClassificationOnly = true) {
    let result;
    if (matchClassificationOnly) {
      result = this.#contracts.find((localSpec: ContractSpecification) => {
        return (
          localSpec.layer == testSpec.layer &&
          localSpec.verb == testSpec.verb &&
          localSpec.subject == testSpec.subject &&
          localSpec.variation == testSpec.variation &&
          localSpec.platform == testSpec.platform
        );
      });
    } else {
      result = this.#contracts.find((localSpec: ContractSpecification) => {
        return (localSpec = testSpec);
      });
    }
    return result != undefined;
  }

  get(layer: string, verb: string, subject: string, variation: string, platform: string) {
    return this.#contracts.find((c: ContractSpecification) => {
      return (
        c.layer === layer &&
        c.verb === verb &&
        c.subject === subject &&
        c.variation === variation &&
        c.platform === platform
      );
    });
  }
  getByName(name: string) {
    if (!name) {
      return;
    }
    const cg = classifyContractName(name);
    return this.get(cg.layer, cg.verb, cg.subject, cg.variation, cg.platform);
  }

  remove(remSpec: ContractSpecification, matchClassificationOnly = true) {
    if (matchClassificationOnly) {
      this.#contracts = this.#contracts.filter((localSpec) => {
        return !(
          localSpec.layer == remSpec.layer &&
          localSpec.verb == remSpec.verb &&
          localSpec.subject == remSpec.subject &&
          localSpec.variation == remSpec.variation &&
          localSpec.platform === remSpec.platform
        );
      });
      this.saveContext();
    } else {
      this.#contracts = this.#contracts.filter((localSpec) => {
        return !(localSpec == remSpec);
      });
    }
  }
  add(contract: ContractSpecification, overrideIfExists = false) {
    if (!(contract && contract.valid())) {
      console.debug("Failed to import invalid contract specification.", contract.classification);
    } else {
      if (this.exists(contract)) {
        if (overrideIfExists) {
          this.remove(contract);
          this.#contracts.push(contract);
          console.debug("Contract added", contract.classification);
          this.saveContext();
        } else {
          console.debug("Ignoring import of duplicate contract specification without override.");
        }
      } else {
        this.#contracts.push(contract);
        console.debug("Contract added", contract.classification);
        this.saveContext();
      }
    }
  }
  addContractByName(
    name: string,
    description: string,
    requirements: Array<ContractTerm>,
    obligations: Array<ContractTerm>,
    suppliers: Array<string>,
    overrideIfExists = false
  ) {
    const cg = classifyContractName(name);
    const cs = new ContractSpecification(
      cg.layer,
      cg.verb,
      cg.subject,
      cg.variation,
      cg.platform,
      description,
      requirements,
      obligations,
      suppliers
    );
    this.add(cs, overrideIfExists);
  }

  toJSON() {
    return this.#contracts;
  }

  get count() {
    if (this.#contracts) {
      return Object.values(this.#contracts).length;
    } else {
      return 0;
    }
  }
  filter(callback: (value: ContractSpecification, index: number, array: ContractSpecification[]) => any) {
    return Object.values(this.#contracts).filter(callback);
  }

  async updateFromRootDoc(rootContracts: Array<contractClassification>) {
    console.log("Updating contract specifications...");
    try {
      console.debug("Existing specification cache contains", this.count, "contracts.");
      // We now need to (a) remove specs that haven't been fetched and (b) create a list of new specs so that we can queue them for retrieval.

      this.#contracts = this.#contracts.filter((c) => {
        const result = rootContracts.find((rawC) => {
          const rawCresult =
            c.layer == rawC.layer &&
            c.verb == rawC.verb &&
            c.subject == rawC.subject &&
            c.variation == rawC.variation &&
            c.platform == rawC.platform
              ? true
              : false;
          return rawCresult;
        });
        return result != undefined;
      });
      console.debug("Specification cache contains", this.#contracts.length, "contracts after removal of old specifcations.");

      rootContracts.forEach((rawC) => {
        if (
          !this.#contracts.find((c) => {
            return (
              c.layer == rawC.layer &&
              c.verb == rawC.verb &&
              c.subject == rawC.subject &&
              c.variation == rawC.variation &&
              c.platform == rawC.platform
            );
          })
        ) {
          // This is a new contract specification
          const newCs = new ContractSpecification(rawC.layer, rawC.verb, rawC.subject, rawC.variation, rawC.platform);
          this.add(newCs);
          // this.updateContractSpec(newCs); // TODO: Complete this bit
        }
      });

      console.debug("Specification cache contains", this.#contracts.length, "contracts after adding new specifcations.");
    } catch (error) {
      console.debug(error.message);
      throw new Error(`Error updating contracts. ${error.message}`);
    }
    return;
  }
}

export class Protocols {
  context: ExtensionContext;
  #protocols: Array<ProtocolSpecification>;
  apiRootUrl: string;

  constructor() {
    this.context;
    this.#protocols = [];
    this.apiRootUrl = "";
  }
  init(context: ExtensionContext) {
    this.context = context;
  }

  async saveContext() {
    await this.context.globalState.update(GLOBALSTATE_PROTOCOLS_LABEL, this);
    console.debug("Valley cache updated with", this.count, "protocols.");
  }

  restoreContext() {
    const pArray = this.context.globalState.get(GLOBALSTATE_PROTOCOLS_LABEL, []);
    console.debug("R:", pArray);

    if (pArray) {
      pArray.forEach((p) => {
        if (isProtocolName(p.name)) {
          const ps = parseProtocolSpec(p);
          // console.debug("S:", cs);
          if (ps.valid()) {
            if (!this.exists(ps)) {
              this.#protocols.push(ps);
            } else {
              console.debug("Not restoring duplicate protocol specification:", ps.classification);
            }
          } else {
            console.debug("Not restoring invalid protocol specification:", ps.classification);
          }
        }
      });
      console.debug(this.#protocols.length, "protocol specifications restored from context.");
      console.debug("Valley restored from cache with", this.count, "protocols.");
    } else {
      console.debug("Valley initialised with zero protocols.");
    }
  }
  resetContext() {
    this.context.globalState.update(GLOBALSTATE_PROTOCOLS_LABEL, null);
  }

  exists(testSpec: ProtocolSpecification, matchClassificationOnly = true) {
    let result;
    if (matchClassificationOnly) {
      result = this.#protocols.find((localSpec: ProtocolSpecification) => {
        return (
          localSpec.layer == testSpec.layer &&
          localSpec.subject == testSpec.subject &&
          localSpec.variation == testSpec.variation &&
          localSpec.platform == testSpec.platform
        );
      });
    } else {
      result = this.#protocols.find((localSpec: ProtocolSpecification) => {
        return (localSpec = testSpec);
      });
    }
    return result != undefined;
  }

  get(layer: string, subject: string, variation: string, platform: string) {
    return this.#protocols.find((c: ProtocolSpecification) => {
      return (
        c.layer === layer &&
        c.subject === subject &&
        c.variation === variation &&
        c.platform === platform
      );
    });
  }
  getByName(name: string) {
    if (!name) {
      return;
    }

    const cg = classifyProtocolName(name);
    return this.get(cg.layer, cg.subject, cg.variation, cg.platform);
  }

  remove(remSpec: ProtocolSpecification, matchClassificationOnly = true) {
    if (matchClassificationOnly) {
      this.#protocols = this.#protocols.filter((localSpec) => {
        return !(
          localSpec.layer == remSpec.layer &&
          localSpec.subject == remSpec.subject &&
          localSpec.variation == remSpec.variation &&
          localSpec.platform === remSpec.platform
        );
      });
      this.saveContext();
    } else {
      this.#protocols = this.#protocols.filter((localSpec) => {
        return !(localSpec == remSpec);
      });
    }
  }
  add(protocol: ProtocolSpecification, overrideIfExists = false) {
    if (!(protocol && protocol.valid())) {
      console.debug("Failed to import invalid protocol specification.", protocol.classification);
    } else {
      if (this.exists(protocol)) {
        if (overrideIfExists) {
          this.remove(protocol);
          this.#protocols.push(protocol);
          console.debug("Protocol added", protocol.classification);
          this.saveContext();
        } else {
          console.debug("Ignoring import of duplicate protocol specification without override.");
        }
      } else {
        this.#protocols.push(protocol);
        console.debug("Protocol added", protocol.classification);
        this.saveContext();
      }
    }
  }
  addByName(
    name: string,
    description: string,
    requirements: Array<ContractTerm>,
    obligations: Array<ContractTerm>,
    suppliers: Array<string>,
    overrideIfExists = false
  ) {
    const pg = classifyProtocolName(name);
    const ps = new ProtocolSpecification(pg.layer, pg.subject, pg.variation, pg.platform, description);
    this.add(ps, overrideIfExists);
  }

  toJSON() {
    return this.#protocols;
  }

  get count() {
    if (this.#protocols) {
      return Object.values(this.#protocols).length;
    } else {
      return 0;
    }
  }
  filter(callback: (value: ProtocolSpecification, index: number, array: ProtocolSpecification[]) => any) {
    return Object.values(this.#protocols).filter(callback);
  }

  async updateFromRootDoc(rootProtocols: Array<protocolClassification>) {
    console.log("Updating protocol specifications...");
    try {
      console.debug("Existing specification cache contains", this.count, "protocols.");
      // We now need to (a) remove specs that haven't been fetched and (b) create a list of new specs so that we can queue them for retrieval.

      this.#protocols = this.#protocols.filter((c) => {
        const result = rootProtocols.find((rawC) => {
          const rawCresult =
            c.layer == rawC.layer && c.subject == rawC.subject && c.variation == rawC.variation && c.platform == rawC.platform
              ? true
              : false;
          return rawCresult;
        });
        return result != undefined;
      });
      console.debug("Specification cache contains", this.#protocols.length, "protocols after removal of old specifications.");

      rootProtocols.forEach((rawP) => {
        if (
          !this.#protocols.find((p) => {
            return p.layer == rawP.layer && p.subject == rawP.subject && p.variation == rawP.variation && p.platform == rawP.platform;
          })
        ) {
          // This is a new protocol specification
          const newPs = new ProtocolSpecification(rawP.layer, rawP.subject, rawP.variation, rawP.platform);
          this.add(newPs);
          // this.updateProtocolSpec(newPs); // TODO: Complete this bit
        }
      });

      console.debug("Specification cache contains", this.#protocols.length, "protocols after adding new specifcations.");
    } catch (error) {
      console.debug(error.message);
      throw new Error(`Error updating protocols. ${error.message}`);
    }
    return;
  }
}

class ProtocolRole {
  #reqs: Array<ContractTerm>;
  #oblgs: Array<ContractTerm>;
  #macro: Array<string>;

  constructor() {
    this.#reqs;
    this.#oblgs;
    this.#macro;
  }
  // TODO: More to go here to work with these.
}

class ProtocolSpecification {
  #layer: string;
  #subject: string;
  #variation: string;
  #platform: string;
  #description: string;
  #host: ProtocolRole;
  #join: ProtocolRole;

  constructor(layer: string, subject: string, variation: string, platform: string, description = "") {
    this.#layer = layer;
    this.#subject = subject;
    this.#variation = variation;
    this.#platform = platform;
    this.#description = description;
    this.#host = new ProtocolRole();
    this.#join = new ProtocolRole();
  }
  valid(): boolean {
    return (
      this.#layer &&
      this.#layer != "" &&
      this.#subject &&
      this.#subject != "" &&
      this.#variation &&
      this.#variation != "" &&
      this.#platform &&
      this.#platform != ""
    );
  }
  get classification(): string {
    return "/" + this.#layer + "/" + "/" + this.#subject + "/" + this.#variation + "/" + this.#platform;
  }
  get layer(): string {
    return this.#layer;
  }
  get subject(): string {
    return this.#subject;
  }
  get variation(): string {
    return this.#variation;
  }
  get platform(): string {
    return this.#platform;
  }
}

function specObj(layer, verb, subject, variation, platform, supplier) {
  this.layer = layer;
  this.verb = verb;
  this.subject = subject;
  this.variation = variation;
  this.platform = platform;
  this.supplier = supplier;
}

async function fetchApiJson(url: RequestInfo): Promise<any> {
  const init: RequestInit = {
    headers: {"cache-control": "no-cache"}
  };
  return fetch(url, init)
  .then((res) => res.json())
    // .then((res) => {
    //   if (res.size == 0) {
    //     throw { type: "empty-response", message: "Received empty response fetching " + JSON.stringify(url) };
    //   }
    //   return res.json();
    // })
    .catch((error) => {
      switch (error.type) {
        case "invalid-json":
          throw new Error("Invalid JSON received from " + JSON.stringify(url));
          break;
        case "empty-response":
          throw new Error("Received empty response fetching " + JSON.stringify(url));
          break;
        case "system":
          switch (error.code) {
            case "ECONNRESET":
              throw new Error("Connection timed out fetching " + JSON.stringify(url));
              break;
            default:
              throw new Error("A system error ocurred fetching " + JSON.stringify(url));
              console.debug(error);
              break;
          }
          break;

        default:
          throw new Error("Failed to fetch " + JSON.stringify(url));
          break;
      }
    });
}

async function fetchApiText(url: RequestInfo): Promise<string> {
  return fetch(url)
    .then((data) => {
      return data.text();
    })
    .catch((error) => {
      console.debug(error);
      switch (error.type) {
        // case "???":
        // 	lastGatewayError="Invalid JSON received from " + JSON.stringify(url);
        // 	break;

        default:
          throw new Error("Failed to fetch " + JSON.stringify(url));
          break;
      }
    });
}

function isProtocolName(name: string): boolean {
  return name ? (name.match(/\//g) || []).length === 4 : false;
}
function isContractName(name: string): boolean {
  return name ? (name.match(/\//g) || []).length === 5 : false;
}

function classifyContractName(name: string): contractClassification {
  if (name) {
    const groups = name.match(/\/(?<layer>[^/]+)\/(?<verb>[^/]+)\/(?<subject>[^/]+)\/(?<variation>[^/]+)\/(?<platform>[^/]+)/);
    if (groups) {
      const g = [...groups] as [string, string, string, string, string, string];
      return { layer: g[1], verb: g[2], subject: g[3], variation: g[4], platform: g[5] };
    } else {
      return;
    }
  } else {
    throw new Error(`Invalid contract name: ${name}`);
  }
}

function classifyProtocolName(name: string): protocolClassification {
  const groups = name.match(/\/(?<layer>[^/]+)\/(?<subject>[^/]+)\/(?<variation>[^/]+)\/(?<platform>[^/]+)/);
  if (groups) {
    const g = [...groups] as [string, string, string, string, string];
    return { layer: g[1], subject: g[2], variation: g[3], platform: g[4] };
  } else {
    throw new Error(`Invalid protocol name: ${name}`);
  }
}

function parseProtocolSpec(objStr: string) {
  const obj = JSON.parse(objStr);
  const reqs: Array<ContractTerm> = [];
  const oblgs: Array<ContractTerm> = [];
  let c: any;

  if (obj.name && obj.type) {
    if (obj.type == "protocol") {
      c = classifyProtocolName(obj.name);
      obj.requirements.forEach((r: contractTerm) => {
        reqs.push(new ContractTerm(r.name, r.type, r.protocol, r.hint, r.length, r.minimum, r.maximum));
      });
      obj.obligations.forEach((o: contractTerm) => {
        oblgs.push(new ContractTerm(o.name, o.type, o.protocol, o.hint, o.length, o.minimum, o.maximum));
      });
    }
    return new ProtocolSpecification(c.layer, c.subject, c.variation, c.platform, obj.descr ? obj.descr : "");
  }
}

function parseContractSpec(obj: {
  name: string;
  type: string;
  description: string;
  requirements: Array<ContractTerm>;
  obligations: Array<ContractTerm>;
}) {
  const reqs: Array<ContractTerm> = [];
  const oblgs: Array<ContractTerm> = [];
  let c: contractClassification;

  if (obj.name && obj.type) {
    if (obj.type == "supplier") {
      c = classifyContractName(obj.name);
      obj.requirements.forEach((r: contractTerm) => {
        reqs.push(new ContractTerm(r.name, r.type, r.protocol, r.hint, r.length, r.minimum, r.maximum));
      });
      obj.obligations.forEach((o: contractTerm) => {
        oblgs.push(new ContractTerm(o.name, o.type, o.protocol, o.hint, o.length, o.minimum, o.maximum));
      });
    }
    return new ContractSpecification(
      c.layer,
      c.verb,
      c.subject,

      c.variation,
      c.platform,
      obj.description ? obj.description : "",
      reqs,
      oblgs
    );
  }
}
