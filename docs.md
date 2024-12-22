
# Jetton Staking


### Functions

- staking for specified period
- static percentage
- totally blocked funds
- unstaking after period end


### Contracts

- Base pool
- Individual staking

Base pool contract stores all staking settings, owns all staking rewards, gets funds for stakes and resends them to individual staking contracts

Individual staking contract owns funds during staking period


### Structures

- **Pool contract storage**

```
pool_storage admin_address:MsgAddress jetton_master:MsgAddress jetton_wallet_code:^Cell staking_code:^Cell staking_params:^Cell
```

`admin_address` - address with ability to change staking_params \
`jetton_master` - address of staking jetton \
`jetton_wallet_code` - BOC of jetton wallet contract \
`staking_code` - BOC of individual staking contract \
`staking_params` - cell with current staking params

- **Staking params**

```
staking_params minimal_sum:Coins minimal_time:uint64 staking_percent:uint64
```

`minimal_sum` - minimal jetton amount to stake \
`minimal_time` - minimal stake period (in seconds) \
`staking_percent` - yearly staking percent (in percents, not float)

- **Individual staking contract storage**

```
staking_storage base_address:MsgAddress owner_address:MsgAddress next_stake_index:uint64 stakes:(HashmapE 64 ^Cell) jetton_master:MsgAddress jetton_wallet_code:^Cell
```

`base_address` - address of staking base pool \
`owner_address` - receiver of staking rewards \
`next_stake_index` - index of next key in stakes dict \
`stakes` - dict of stakes \
`jetton_master` - address of staking jetton \
`jetton_wallet_code` - BOC of jetton wallet contract

- **Stakes**

Dictionary storage of stakes in individual staking contract \
Stakes are set in `dict` by `udict_set` method with uint64 index starting from 0 \
Index increases by 1 each stake

- **Stake item**

```
stake_item stake_sum:Coins final_sum:Coins start_time:uint64 end_time:uint64
```

`stake_sum` - primary amount of jettons \
`final_sum` - amount of jettons received after stake \
`start_time` - stake start timestamp \
`end_time` - stake end timestamp


### Base pool methods

- **Deploy staking contract** \
Required for each address \
Has no parameters



Received funds will be resent to individual staking contract

```
deploy_staking#00000001
```

- **Create stake** \
Placed in payload of jetton transfer

```
stake#00000002 stake_time:uint64
```

`stake_time` - stake period in seconds

### Individual staking methods


- **Create stake** \
Placed in payload of jetton transfer \
Must be sent from base pool address

```
stake#00000001 stake_sum:Coins final_sum:Coins start_time:uint64 end_time:uint64
```

- **Unstake funds** \
Is able after stake period

```
unstake#00000002 stake_index:uint64
```

`stake_index` - index of stake in contract storage for unstaking
