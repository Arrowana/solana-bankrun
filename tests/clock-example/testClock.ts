import test from "ava";
import { Clock, start } from "../../solana-bankrun";
import {
	PublicKey,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";

test("clock", async (t) => {
	const programId = PublicKey.unique();
	const context = await start(
		[{ name: "bankrun_clock_example", programId }],
		[],
	);
	const client = context.banksClient;
	const payer = context.payer;
	const blockhash = context.lastBlockhash;
	const ixs = [
		new TransactionInstruction({ keys: [], programId, data: Buffer.from("") }),
	];
	let tx = new Transaction();
	tx.recentBlockhash = blockhash;
	tx.add(...ixs);
	tx.sign(payer);
	// this will fail because it's not January 1970 anymore
	const error = await t.throwsAsync(
		async () => await client.processTransaction(tx),
	);
	t.assert(error?.message.includes("Program failed to complete"));
	// so let's turn back time
	const currentClock = await client.getClock();
	context.setClock(
		new Clock(
			currentClock.slot,
			currentClock.epochStartTimestamp,
			currentClock.epoch,
			currentClock.leaderScheduleEpoch,
			50n,
		),
	);
	const ixs2 = [
		new TransactionInstruction({
			keys: [],
			programId,
			data: Buffer.from("foobar"), // unused, just here to dedup the tx
		}),
	];
	let tx2 = new Transaction();
	tx2.recentBlockhash = blockhash;
	tx2.add(...ixs2);
	tx2.sign(payer);
	// now the transaction goes through
	await client.processTransaction(tx2);
});
