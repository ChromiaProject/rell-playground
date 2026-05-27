@file:JvmName("PlaygroundJsBridge")

package com.chromia.rellplayground

import net.postchain.rell.base.runtime.Rt_RellVersion
import org.teavm.jso.JSExport

@JSExport
fun version(): String = Rt_RellVersion.getInstance().buildDescriptor

fun main() {}
