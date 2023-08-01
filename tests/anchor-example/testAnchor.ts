import test from "ava";
import {
  BanksClient,
  ProgramTestContext,
  startAnchor,
} from "../../solana-bankrun";
import {
  AccountInfo,
  Commitment,
  ConfirmOptions,
  Connection,
  GetAccountInfoConfig,
  GetLatestBlockhashConfig,
  Keypair,
  PublicKey,
  RpcResponseAndContext,
  SendOptions,
  Signer,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AnchorProvider,
  BN,
  Program,
  Provider,
  Wallet,
} from "@coral-xyz/anchor";
import { IDL as PuppetIDL, Puppet } from "./puppet";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { SuccessfulTxSimulationResponse } from "@coral-xyz/anchor/dist/cjs/utils/rpc";
import bs58 from "bs58";

const PUPPET_PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

const PUPPET_MASTER_PROGRAM_ID = new PublicKey(
  "HmbTLCmaGvZhKnn1Zfa1JVnp7vkMV4DYVxPLWBVoN65L"
);

interface ConnectionInterface {
  getAccountInfoAndContext: Connection["getAccountInfoAndContext"];
  getLatestBlockhash: Connection["getLatestBlockhash"];
}

class BankrunConnectionProxy implements ConnectionInterface {
  constructor(private banksClient: BanksClient) {}
  async getAccountInfoAndContext(
    publicKey: PublicKey,
    commitmentOrConfig?: Commitment | GetAccountInfoConfig | undefined
  ): Promise<RpcResponseAndContext<AccountInfo<Buffer>>> {
    const accountInfoBytes = await this.banksClient.getAccount(publicKey);
    if (!accountInfoBytes)
      throw new Error(`Could not find ${publicKey.toBase58()}`);
    return {
      context: { slot: Number(await this.banksClient.getSlot()) },
      value: {
        ...accountInfoBytes,
        data: Buffer.from(accountInfoBytes.data),
      },
    };
  }
  async getLatestBlockhash(
    commitmentOrConfig?: Commitment | GetLatestBlockhashConfig | undefined
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const result = await this.banksClient.getLatestBlockhash();
    if (!result) throw new Error("Could not get latest blockhash");
    const [blockhash, lastValidBlockHeight] = result;
    return {
      blockhash,
      lastValidBlockHeight: Number(lastValidBlockHeight),
    };
  }
}
class BankrunProvider implements Provider {
  connection: Connection;
  wallet: Wallet;

  constructor(private context: ProgramTestContext) {
    this.wallet = new NodeWallet(context.payer);
    this.connection = new BankrunConnectionProxy(
      context.banksClient
    ) as any as Connection; // uh
  }

  send?(
    tx: Transaction | VersionedTransaction,
    signers?: Signer[] | undefined,
    opts?: SendOptions | undefined
  ): Promise<string> {
    throw new Error("Method not implemented.");
  }
  async sendAndConfirm?(
    tx: Transaction | VersionedTransaction,
    signers?: Signer[] | undefined,
    opts?: ConfirmOptions | undefined
  ): Promise<string> {
    if ("version" in tx) {
      signers?.forEach((signer) => tx.sign([signer]));
    } else {
      tx.feePayer = tx.feePayer ?? this.wallet.publicKey;
      tx.recentBlockhash = (
        await this.connection.getLatestBlockhash()
      ).blockhash;

      signers?.forEach((signer) => tx.partialSign(signer));
    }
    this.wallet.signTransaction(tx);

    let signature: string;
    if ("version" in tx) {
      signature = bs58.encode(tx.signatures[0]);
    } else {
      if (!tx.signature) throw new Error("Missing fee payer signature");
      signature = bs58.encode(tx.signature);
    }
    const meta = await this.context.banksClient.processTransaction(tx);
    return signature;
  }
  sendAll?<T extends Transaction | VersionedTransaction>(
    txWithSigners: { tx: T; signers?: Signer[] | undefined }[],
    opts?: ConfirmOptions | undefined
  ): Promise<string[]> {
    throw new Error("Method not implemented.");
  }
  simulate?(
    tx: Transaction | VersionedTransaction,
    signers?: Signer[] | undefined,
    commitment?: Commitment | undefined,
    includeAccounts?: boolean | PublicKey[] | undefined
  ): Promise<SuccessfulTxSimulationResponse> {
    throw new Error("Method not implemented.");
  }
}

test("anchor", async (t) => {
  const context = await startAnchor("tests/anchor-example", [], []);

  const provider = new BankrunProvider(context);

  const puppetProgram = new Program<Puppet>(
    PuppetIDL,
    PUPPET_PROGRAM_ID,
    provider
  );

  const puppetKeypair = Keypair.generate();
  const s1 = await puppetProgram.methods
    .initialize()
    .accounts({
      puppet: puppetKeypair.publicKey,
    })
    .signers([puppetKeypair])
    .rpc();
  console.log(s1);

  const data = new BN(123456);
  const s2 = await puppetProgram.methods
    .setData(data)
    .accounts({
      puppet: puppetKeypair.publicKey,
    })
    .rpc();
  console.log(s2);

  const dataAccount = await puppetProgram.account.data.fetch(
    puppetKeypair.publicKey
  );
  console.log(dataAccount);
  t.assert(dataAccount.data.eq(new BN(123456)));
});
