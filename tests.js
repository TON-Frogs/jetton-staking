const fs = require('fs');
const ton_core = require('@ton/core');
const compiler = require('@ton-community/func-js');
const ton_sandbox = require('@ton/sandbox');


const beginCell = ton_core.beginCell;
const Cell = ton_core.Cell;


let ton;

let jetton_minter_code = Cell.fromBoc(fs.readFileSync('contracts/boc/jetton_minter.boc'))[0];
let jetton_wallet_code = Cell.fromBoc(fs.readFileSync('contracts/boc/jetton_wallet.boc'))[0];
let staking_pool_code;
let staking_code;


let wallet;
let jetton_minter;
let jetton_wallet;
let pool;
let staking;
let pool_jetton_wallet;
let staking_jetton_wallet;


let year_percent = 32;


async function compile(filename) {

    let r = {
        targets: ['stdlib.fc', filename],
        sources: {
            'stdlib.fc': fs.readFileSync('contracts/stdlib.fc', 'utf-8'),
        }
    };

    r.sources[filename] = fs.readFileSync(`contracts/${filename}`, 'utf-8');
    
    r = await compiler.compileFunc(r);

    if(r.status === 'error') throw Error(r.message);

    return Cell.fromBase64(r.codeBoc);

}


function logTxs(txs) {

    for(let tx of txs.transactions) {

        console.log(tx.inMessage);
        console.log(tx.vmLogs);

    }

}





function init(init_data) {

    return {
        init: init_data,
        address: ton_core.contractAddress(0, init_data)
    };

}

function jettonMinter(params) {
    
    return init({
        code: jetton_minter_code,
        data: beginCell()
            .storeCoins(0)
            .storeAddress(params.owner)
            .storeRef(beginCell().endCell())
            .storeRef(jetton_wallet_code)
        .endCell()
    });
    
}

function stakingPool(params) {
    
    return init({
        code: staking_pool_code,
        data: beginCell()
            .storeAddress(params.admin_address)
            .storeAddress(params.jetton_master)
            .storeRef(jetton_wallet_code)
            .storeRef(staking_code)
            .storeRef(beginCell()
                .storeCoins(params.staking_params.minimal_sum)
                .storeUint(params.staking_params.minimal_time, 64)
                .storeUint(params.staking_params.staking_percent, 64)
            .endCell())
        .endCell()
    });

}



async function balance(address) {

    return (await ton.getContract(address)).balance;

}

async function getAddress(method, master, address) {

    return (await ton.runGetMethod(master, method, [{
        type: 'slice',
        cell: beginCell().storeAddress(address).endCell()
    }])).stack[0].cell.asSlice().loadAddress();

}




async function deployJetton() {
    
    return await wallet.send({
        to: jetton_minter.address,
        value: 0.1e9,
        init: jetton_minter.init
    });

}

async function jettonMint(params) {
    
    return await wallet.send({
        to: jetton_minter.address,
        value: 0.1e9,
        body: beginCell()
            .storeUint(21, 32)
            .storeUint(0, 64)
            .storeAddress(params.to)
            .storeCoins(0.1e9)
            .storeRef(beginCell()
                .storeUint(0x178d4519, 32)
                .storeUint(0, 64)
                .storeCoins(params.sum)
                .storeAddress(null)
                .storeAddress(null)
                .storeCoins(0)
                .storeBit(0)
            .endCell())
        .endCell()
    });

}

async function jettonBalance(address) {

    return (await ton.runGetMethod(address, 'get_wallet_data')).stack[0].value;

}

function jettonBody(params) {

    return beginCell()
        .storeUint(0xf8a7ea5, 32)
        .storeUint(params.query_id || 0, 64)
        .storeCoins(params.sum)
        .storeAddress(params.to)
        .storeAddress(wallet.address)
        .storeBit(0)
        .storeCoins(params.payload_amount || 1)
        .storeBit(1)
        .storeRef(params.payload)
    .endCell();

}


async function sendJettons(params) {

    return await wallet.send({
        to: jetton_wallet,
        value: 0.1e9 + (params.payload_amount || 0),
        body: jettonBody({
            to: params.to,
            sum: params.sum,
            payload_amount: params.payload_amount || 1,
            payload: params.payload
        })
    });

}



async function deployStakingPool() {
    
    return await wallet.send({
        to: pool.address,
        value: 0.1e9,
        init: pool.init
    });

}

async function deployStaking() {

    return await wallet.send({
        to: pool.address,
        value: 0.05e9,
        body: beginCell()
            .storeUint(1, 32)
        .endCell()
    });

}

async function stake(params) {

    return await sendJettons({
        to: pool.address,
        sum: params.sum,
        payload_amount: 0.1e9,
        payload: beginCell()
            .storeUint(2, 32)
            .storeUint(params.time, 64)
        .endCell()
    });

}


function send_unstake(stake_index) {

    return wallet.send({
        to: staking,
        value: 0.1e9,
        body: beginCell()
            .storeUint(2, 32)
            .storeUint(0, 64)
            .storeUint(stake_index, 64)
        .endCell()
    });

}


async function unstake(stake) {

    ton.now = stake.end+1;

    let r = await send_unstake(stake.index);

    delete ton.now;

    return r;

}

async function getStakes() {

    let stakes = (await ton.runGetMethod(staking, 'get_staking_data')).stack[3];
    let r = [];

    if(stakes.type === 'cell') {
        
        stakes = stakes.cell.asSlice().loadDictDirect(ton_core.Dictionary.Keys.Uint(64), { parse: (src) => src });
        
        for(let stake of stakes._map) {

            r.push({
                index: Number(stake[0].substring(2)),
                claimed: stake[1].loadBit(),
                sum: stake[1].loadCoins(64),
                final_sum: stake[1].loadCoins(64),
                start: stake[1].loadUint(64),
                end: stake[1].loadUint(64)
            });

        }

    }

    return r;

}


function setStakingParams(params) {

    return wallet.send({
        to: pool.address,
        value: 0.01e9,
        body: beginCell()
            .storeUint(10, 32)
            .storeRef(beginCell()
                .storeCoins(params.minimal_sum)
                .storeUint(params.minimal_time, 64)
                .storeUint(params.staking_percent, 64)
            .endCell())
        .endCell()
    });

}



function calculateProfit(params) {
    
    return params.sum + Math.floor(params.sum * year_percent * params.time / 3153600000);

}


async function checkOne(params) {
    
    console.log('\nStarting single stake test', params);

    let bal1;
    
    try {

        bal1 = await jettonBalance(staking_jetton_wallet);

    } catch {

        bal1 = 0n;

    }


    await stake(params);
    
    let bal2 = await jettonBalance(staking_jetton_wallet);
    let stakes = await getStakes();
    let final_sum = BigInt(calculateProfit(params));
    
    if(bal2-bal1 === final_sum && final_sum === stakes[stakes.length-1].final_sum) 
        console.log(`SUCCESS: Contract got correct final_sum ${final_sum}`);
        else throw Error(`ERROR: Contract got: ${bal2-bal1}, stake final sum: ${stakes[stakes.length-1].final_sum}, correct final sum: ${final_sum}`);



    bal1 = await jettonBalance(jetton_wallet);

    await send_unstake(stakes[stakes.length-1].index);

    bal2 = await jettonBalance(jetton_wallet);

    if(bal2-bal1 === 0n) 
        console.log(`SUCCESS: Contract didn't send reward before stake end`);
        else throw Error(`ERROR: Contract sent reward before stake end`);



    await unstake(stakes[stakes.length-1]);

    bal2 = await jettonBalance(jetton_wallet);

    if(bal2-bal1 === final_sum)
        console.log(`SUCCESS: Contract sent correct reward ${final_sum}`);
        else throw Error(`ERROR: Contract sent wrond reward ${bal2-bal1}`);


    stakes = await getStakes();

    if(stakes[stakes.length-1].claimed === true)
        console.log(`SUCCESS: Stake status changed to claimed`);
        else throw Error(`ERROR: Stake status is ${stakes[stakes.length-1].claimed}`);


}


async function checkMany(params) {
    
    console.log('\nStarting many stakes test', params);

    let stake_params = {
        sum: params.sum_step,
        time: params.time_step
    };

    for(let i = 0; i < params.count; i++) {

        let bal1;
        
        try {

            bal1 = await jettonBalance(staking_jetton_wallet);

        } catch {

            bal1 = 0n;

        }


        await stake(stake_params);
        
        let bal2 = await jettonBalance(staking_jetton_wallet);
        let stakes = await getStakes();
        let final_sum = BigInt(calculateProfit(stake_params));
        
        if(bal2-bal1 !== final_sum || final_sum !== stakes[stakes.length-1].final_sum) 
            throw Error(`ERROR: Contract got: ${bal2-bal1}, stake final sum: ${stakes[stakes.length-1].final_sum}, correct final sum: ${final_sum}`);



        bal1 = await jettonBalance(jetton_wallet);

        await send_unstake(stakes[stakes.length-1].index);

        bal2 = await jettonBalance(jetton_wallet);

        if(bal2-bal1 !== 0n) 
            throw Error(`ERROR: Contract sent reward before stake end`);


        await unstake(stakes[stakes.length-1]);

        bal2 = await jettonBalance(jetton_wallet);

        if(bal2-bal1 !== final_sum)
            throw Error(`ERROR: Contract sent wrond reward ${bal2-bal1}`);


        stakes = await getStakes();

        if(stakes[stakes.length-1].claimed !== true)
            throw Error(`ERROR: Stake status is ${stakes[stakes.length-1].claimed}`);

        
        stake_params.sum += params.sum_step;
        stake_params.time += params.time_step;

    }

    console.log('Many stakes test: SUCCESS\nLast stake:', stake_params);

}



async function checkAdminCall(params) {

    year_percent = params.staking_percent;
    
    console.log('\nStarting admin function test', params);

    await setStakingParams(params);

    let new_params = (await ton.runGetMethod(pool.address, 'get_staking_pool_data')).stack[4].cell.asSlice();
    let minimal_sum = new_params.loadCoins();
    let minimal_time = new_params.loadUint(64);
    let staking_percent = new_params.loadUint(64);

    if(minimal_sum === BigInt(params.minimal_sum) && minimal_time === params.minimal_time && staking_percent === params.staking_percent)
        console.log(`SUCCESS: Staking params were changed correctly`);
        else throw Error(`ERROR: Staked params weren't changed correctly. minimal_sum: ${minimal_sum}, minimal_time: ${minimal_time}, staking_percent: ${staking_percent}`);

}



(async () => {

    staking_pool_code = await compile('staking_pool.fc');
    staking_code = await compile('staking.fc');
    

    ton = await ton_sandbox.Blockchain.create();

    wallet = await ton.treasury('wallet');


    jetton_minter = jettonMinter({
        owner: wallet.address
    });

    await deployJetton();


    await jettonMint({
        to: wallet.address,
        sum: 10000000e9
    });


    jetton_wallet = await getAddress('get_wallet_address', jetton_minter.address, wallet.address);

    
    pool = stakingPool({
        admin_address: wallet.address,
        jetton_master: jetton_minter.address,
        staking_params: {
            minimal_sum: 1e9,
            minimal_time: 1,
            staking_percent: year_percent
        }
    });


    await deployStakingPool();

    await deployStaking();


    await sendJettons({
        to: pool.address,
        sum: 5000000e9,
        payload: beginCell()
            .storeUint(0, 32)
            .storeUint(0, 64)
        .endCell()
    });


    staking = await getAddress('get_staking_address', pool.address, wallet.address);
    pool_jetton_wallet = await getAddress('get_wallet_address', jetton_minter.address, pool.address);
    staking_jetton_wallet = await getAddress('get_wallet_address', jetton_minter.address, staking);

    console.log('pool address:', pool.address);
    console.log('staking address:', staking);


    console.log('\nStart wallet jetton balance:', await jettonBalance(jetton_wallet));


    await checkOne({
        sum: 1000e9,
        time: 1
    });


    await checkMany({
        count: 20,
        sum_step: 6500e9,
        time_step: 4000
    });


    await checkAdminCall({
        minimal_sum: 500e9,
        minimal_time: 86400,
        staking_percent: 57
    });


    await checkOne({
        sum: 5000000e9,
        time: 86400*365
    });

    console.log('\nEnd wallet jetton balance:', await jettonBalance(jetton_wallet));

})();