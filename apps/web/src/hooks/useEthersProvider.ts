// 导入必要的依赖
import { Web3Provider } from '@ethersproject/providers' // 以太坊Web3 Provider
import { useAccount } from 'hooks/useAccount' // 账户信息Hook
import { useMemo } from 'react' // React性能优化Hook
import type { Chain, Client, Transport } from 'viem' // Viem类型定义
import { useClient, useConnectorClient } from 'wagmi' // Wagmi客户端Hook

// 使用WeakMap存储Client到Web3Provider的映射，避免重复创建Provider
// WeakMap允许垃圾回收，不会造成内存泄漏
const providers = new WeakMap<Client, Web3Provider>()

/**
 * 将Viem客户端转换为ethers.js Provider
 * @param client Viem客户端对象
 * @param chainId 可选的链ID
 * @returns 转换后的Web3Provider实例或undefined
 */
export function clientToProvider(client?: Client<Transport, Chain>, chainId?: number) {
  // 如果没有提供client，直接返回undefined
  if (!client) {
    return undefined
  }
  
  // 从client中解构chain和transport
  const { chain, transport } = client

  // 构建network配置对象
  // 优先使用client中的chain信息
  const network = chain
    ? {
        chainId: chain.id, // 链ID
        name: chain.name, // 链名称
        ensAddress: chain.contracts?.ensRegistry?.address, // ENS注册表地址
      }
    : chainId
      ? { chainId, name: 'Unsupported' } // 如果提供了chainId但没有chain信息
      : undefined
      
  // 如果无法确定network，返回undefined
  if (!network) {
    return undefined
  }

  // 使用WeakMap缓存Provider实例，避免重复创建
  if (providers.has(client)) {
    return providers.get(client) // 返回缓存的Provider
  } else {
    // 创建新的Web3Provider实例并缓存
    const provider = new Web3Provider(transport, network)
    providers.set(client, provider)
    return provider
  }
}

/**
 * 将Viem客户端转换为ethers.js Provider的React Hook
 * 支持断开连接状态的网络回退
 * @param options 配置选项
 * @param options.chainId 可选的链ID
 * @returns Web3Provider实例或undefined
 */
export function useEthersProvider({ chainId }: { chainId?: number } = {}) {
  // 获取当前账户信息
  const account = useAccount()
  // 获取连接的客户端
  const { data: client } = useConnectorClient({ chainId })
  // 获取断开连接状态的客户端
  const disconnectedClient = useClient({ chainId })
  
  // 使用useMemo优化性能，避免不必要的重新计算
  return useMemo(
    () => {
      // 逻辑：如果账户的链ID与指定的chainId不同，则使用disconnectedClient
      // 否则优先使用连接的client，如果client不存在则使用disconnectedClient
      return clientToProvider(
        account.chainId !== chainId ? disconnectedClient : (client ?? disconnectedClient), 
        chainId
      )
    },
    [account.chainId, chainId, client, disconnectedClient],
  )
}

/**
 * 将已连接的Viem客户端转换为ethers.js Provider的React Hook
 * 仅在连接状态下返回Provider
 * @param options 配置选项
 * @param options.chainId 可选的链ID
 * @returns Web3Provider实例或undefined
 */
export function useEthersWeb3Provider({ chainId }: { chainId?: number } = {}) {
  // 获取连接的客户端
  const { data: client } = useConnectorClient({ chainId })
  
  // 使用useMemo优化性能
  return useMemo(() => clientToProvider(client, chainId), [chainId, client])
}
